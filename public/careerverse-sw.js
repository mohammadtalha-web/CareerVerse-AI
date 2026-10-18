self.addEventListener("push", (event) => {
  let notification = {};
  try {
    notification = event.data ? event.data.json() : {};
  } catch {
    notification = {};
  }

  const title = typeof notification.title === "string" ? notification.title : "CareerVerse update";
  const options = {
    body: typeof notification.body === "string" ? notification.body : "You have a new notification.",
    data: { url: typeof notification.url === "string" ? notification.url : "/networking/feed" },
    tag: "careerverse-notification",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data && typeof event.notification.data.url === "string"
    ? event.notification.data.url
    : "/networking/feed";
  const safePath = /^\/(?:jobs|networking)(?:\/|\?|$)/.test(path) ? path : "/networking/feed";
  const target = new URL(safePath, self.location.origin).href;

  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) {
        return client.navigate(target).then((navigated) => navigated?.focus() ?? client.focus());
      }
    }
    return self.clients.openWindow(target);
  }));
});
