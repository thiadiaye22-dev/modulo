"use strict";

const pad = n => String(n).padStart(2, "0");
const isoDate = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const toMinutes = hhmm => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const REMINDER_WINDOW_MIN = 15; // previenir si le service commence dans les 15 min

function startReminders(store, push) {
  let lastDay = isoDate(new Date());
  let notified = new Set();

  async function check() {
    const now = new Date();
    const today = isoDate(now);
    if (today !== lastDay) { notified = new Set(); lastDay = today; }
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const users = store.getUsers();
    for (const restaurantId of store.listRestaurantIds()) {
      const state = store.getRestaurantState(restaurantId);
      if (!state) continue;
      for (const employee of state.employees || []) {
        const shifts = state.shifts[employee.id + "_" + today] || [];
        if (!shifts.length) continue;

        const user = users.find(u => u.restaurantId === restaurantId && u.role === "employee" && u.employeeId === employee.id);
        if (!user || !user.pushSubscriptions || !user.pushSubscriptions.length) continue;

        const pointages = state.pointages[employee.id + "_" + today] || [];
        const hasOpenOrPunched = pointages.some(p => p.in);

        for (let i = 0; i < shifts.length; i++) {
          const startMin = toMinutes(shifts[i].debut);
          const diff = startMin - nowMin;
          const shiftKey = restaurantId + "_" + employee.id + "_" + today + "_" + shifts[i].debut;
          if (diff > 0 && diff <= REMINDER_WINDOW_MIN && !hasOpenOrPunched && !notified.has(shiftKey)) {
            notified.add(shiftKey);
            for (const sub of user.pushSubscriptions) {
              const ok = await push.sendNotification(sub, {
                title: "⏰ Pense à pointer",
                body: "Ton service commence à " + shifts[i].debut + ", n'oublie pas de pointer !",
              });
              if (!ok) store.removeSubscriptionByEndpoint(sub.endpoint);
            }
          }
        }
      }
    }
  }

  setInterval(check, CHECK_INTERVAL_MS);
}

module.exports = { startReminders };
