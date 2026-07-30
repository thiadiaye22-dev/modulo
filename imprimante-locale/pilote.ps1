# Impression d'une étiquette par le pilote Brother installé sur Windows.
#
# Le protocole raster envoyé en direct sur le port 9100 n'a jamais abouti sur
# cette imprimante. Le pilote Brother, lui, sait parler à son propre matériel :
# on lui confie l'image et il se charge de l'encodage.
#
#   .\pilote.ps1 -Action Lister
#   .\pilote.ps1 -Action Formats -Imprimante "Brother QL-820NWB"
#   .\pilote.ps1 -Action Imprimer -Fichier etiquette.png -Imprimante "Brother QL-820NWBc" -LargeurPx 696 -HauteurPx 871

param(
  [Parameter(Mandatory = $true)][ValidateSet('Lister', 'Formats', 'Imprimer')][string]$Action,
  [string]$Fichier,
  [string]$Imprimante,
  [int]$LargeurPx = 696,
  [int]$HauteurPx = 0,
  [int]$Ppp = 300,
  [int]$Copies = 1,
  [string]$Format = ''
)

$ErrorActionPreference = 'Stop'

function Lister {
  # On renvoie une ligne par imprimante : le programme appelant filtrera.
  Get-CimInstance -ClassName Win32_Printer |
    ForEach-Object { $_.Name }
}

function Reglages {
  Add-Type -AssemblyName System.Drawing
  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.PrinterSettings.PrinterName = $Imprimante
  if (-not $doc.PrinterSettings.IsValid) {
    throw "imprimante inconnue de Windows : $Imprimante"
  }
  return $doc
}

# Ce que le pilote Brother déclare savoir faire : ses formats de papier, ses
# résolutions, et la zone réellement imprimable du format par défaut. C'est la
# seule façon de savoir si notre format sur mesure a une chance d'être accepté,
# ou s'il faut passer par un format prédéfini du pilote.
function Formats {
  $doc = Reglages
  $d = $doc.DefaultPageSettings.PaperSize
  Write-Output "DEFAUT`t$($d.PaperName)`t$($d.Width)`t$($d.Height)`t$($d.Kind)"
  $zone = $doc.DefaultPageSettings.PrintableArea
  Write-Output ("ZONE`t{0}`t{1}`t{2}`t{3}" -f $zone.X, $zone.Y, $zone.Width, $zone.Height)
  foreach ($t in $doc.PrinterSettings.PaperSizes) {
    Write-Output "FORMAT`t$($t.PaperName)`t$($t.Width)`t$($t.Height)`t$($t.Kind)"
  }
  foreach ($r in $doc.PrinterSettings.PrinterResolutions) {
    Write-Output "RESOLUTION`t$($r.Kind)`t$($r.X)`t$($r.Y)"
  }
}

function Imprimer {
  if (-not (Test-Path $Fichier)) { throw "fichier introuvable : $Fichier" }
  if ($HauteurPx -le 0) { throw "hauteur manquante" }

  Add-Type -AssemblyName System.Drawing

  $image = [System.Drawing.Image]::FromFile((Resolve-Path $Fichier))
  try {
    $doc = New-Object System.Drawing.Printing.PrintDocument
    $doc.PrinterSettings.PrinterName = $Imprimante
    if (-not $doc.PrinterSettings.IsValid) {
      throw "imprimante inconnue de Windows : $Imprimante"
    }
    $doc.DocumentName = 'Etiquette DLC'
    # Contrôleur standard : pas de fenêtre de progression, adapté à un service.
    $doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
    $doc.PrinterSettings.Copies = $Copies

    # Les unités d'impression de .NET sont des centièmes de pouce. L'image étant
    # produite à 300 points par pouce, on retrouve sa taille physique exacte —
    # l'étiquette sort donc à l'échelle 1:1, sans redimensionnement.
    $largeurCent = [int][Math]::Round($LargeurPx * 100.0 / $Ppp)
    $hauteurCent = [int][Math]::Round($HauteurPx * 100.0 / $Ppp)

    if ($Format -ne '') {
      # Format imposé : on prend celui que le pilote déclare sous ce nom. Le
      # dessin garde sa taille physique propre, donc rien n'est déformé si le
      # format du pilote est plus grand que l'étiquette.
      $choisi = $null
      foreach ($t in $doc.PrinterSettings.PaperSizes) {
        if ($t.PaperName -eq $Format) { $choisi = $t; break }
      }
      if ($null -eq $choisi) {
        throw "format inconnu du pilote : $Format (listez-les avec -Action Formats)"
      }
      $doc.DefaultPageSettings.PaperSize = $choisi
    } else {
      # Format de page sur mesure. Certains pilotes le refusent : on retombe
      # alors sur le format par défaut du pilote plutôt que d'échouer.
      try {
        $taille = New-Object System.Drawing.Printing.PaperSize('Etiquette DLC', $largeurCent, $hauteurCent)
        $taille.RawKind = 0    # 0 = format personnalisé
        $doc.DefaultPageSettings.PaperSize = $taille
      } catch {
        Write-Output "AVERTISSEMENT: format personnalise refuse, format du pilote utilise"
      }
    }
    $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

    # On rapporte le format réellement retenu : c'est lui qui explique une
    # étiquette trop longue, tronquée, ou décalée.
    $retenu = $doc.DefaultPageSettings.PaperSize
    Write-Output ("PAGE: {0} {1}x{2} centiemes de pouce (image {3}x{4})" -f `
      $retenu.PaperName, $retenu.Width, $retenu.Height, $largeurCent, $hauteurCent)

    $doc.add_PrintPage({
      param($expediteur, $e)
      # Origine en haut à gauche de la zone imprimable, sans marge ajoutée.
      $e.Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Display
      $rectangle = New-Object System.Drawing.Rectangle(0, 0, $largeurCent, $hauteurCent)
      $e.Graphics.DrawImage($image, $rectangle)
      $e.HasMorePages = $false
    })

    $doc.Print()
    Write-Output "OK"
  } finally {
    $image.Dispose()
  }
}

switch ($Action) {
  'Lister'   { Lister }
  'Formats'  { Formats }
  'Imprimer' { Imprimer }
}
