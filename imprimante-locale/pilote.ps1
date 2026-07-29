# Impression d'une étiquette par le pilote Brother installé sur Windows.
#
# Le protocole raster envoyé en direct sur le port 9100 n'a jamais abouti sur
# cette imprimante. Le pilote Brother, lui, sait parler à son propre matériel :
# on lui confie l'image et il se charge de l'encodage.
#
#   .\pilote.ps1 -Action Lister
#   .\pilote.ps1 -Action Imprimer -Fichier etiquette.png -Imprimante "Brother QL-820NWBc" -LargeurPx 696 -HauteurPx 871

param(
  [Parameter(Mandatory = $true)][ValidateSet('Lister', 'Imprimer')][string]$Action,
  [string]$Fichier,
  [string]$Imprimante,
  [int]$LargeurPx = 696,
  [int]$HauteurPx = 0,
  [int]$Ppp = 300,
  [int]$Copies = 1
)

$ErrorActionPreference = 'Stop'

function Lister {
  # On renvoie une ligne par imprimante : le programme appelant filtrera.
  Get-CimInstance -ClassName Win32_Printer |
    ForEach-Object { $_.Name }
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

    # Format de page sur mesure. Certains pilotes le refusent : on retombe
    # alors sur le format par défaut du pilote plutôt que d'échouer.
    try {
      $taille = New-Object System.Drawing.Printing.PaperSize('Etiquette DLC', $largeurCent, $hauteurCent)
      $taille.RawKind = 0    # 0 = format personnalisé
      $doc.DefaultPageSettings.PaperSize = $taille
    } catch {
      Write-Output "AVERTISSEMENT: format personnalise refuse, format du pilote utilise"
    }
    $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

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
  'Imprimer' { Imprimer }
}
