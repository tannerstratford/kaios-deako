// Deako Lights installer — runs in the KaiOS system app context after staging.
// It only calls AppsManager.installPackage on our hosted update manifest. No
// signature is created or altered: this is a plain install request, so if the
// phone's verifier rejects an unsigned privileged package we see that verbatim.
(function () {
  "use strict";

  var UPDATE_URL =
    "https://tannerstratford.github.io/kaios-deako/Apps-directory/Deako-Lights/update.webmanifest";

  function show(msg) {
    try { document.title = msg; } catch (e) {}
    try {
      var el = document.getElementById("deako-status");
      if (!el) {
        el = document.createElement("pre");
        el.id = "deako-status";
        el.style.cssText =
          "position:fixed;left:0;top:0;right:0;z-index:99999;margin:0;padding:8px;" +
          "background:#000;color:#0f0;font:12px monospace;white-space:pre-wrap;word-break:break-word";
        (document.body || document.documentElement).appendChild(el);
      }
      el.textContent = msg;
    } catch (e) {}
  }

  if (!window.JScalatedAppsManager) {
    show("Installer error: AppsManager wrapper did not load.");
    return;
  }

  show("Deako Lights: connecting to AppsManager…");
  var client = new window.JScalatedAppsManager(function (m) { show("Deako Lights: " + m); });

  client
    .connect()
    .then(function (manager) {
      show("Deako Lights: installing…\n" + UPDATE_URL);
      return window.JScalatedAppsManager.callUrlMethod(
        manager,
        "installPackage",
        UPDATE_URL
      );
    })
    .then(function (result) {
      show("Deako Lights: INSTALL OK\n" + JSON.stringify(result || {}));
    })
    .catch(function (error) {
      show(
        "Deako Lights: INSTALL FAILED\n" +
          window.JScalatedAppsManager.errorText(error)
      );
    });
}());
