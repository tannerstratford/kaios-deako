// Deako Lights backend: talks HTTP to the local controller (the Flask app
// running on the home machine), which in turn drives the Deako mesh over its
// LAN TCP API. No DOM here. systemXHR lets us reach any LAN host without CORS.
(function (root) {
  "use strict";

  var DEFAULT_HOST = "192.168.1.60:8099";
  var KEY = "deako.cfg";

  var Store = {
    load: function () {
      try {
        var c = JSON.parse(localStorage.getItem(KEY) || "{}");
        if (!c.host) c.host = DEFAULT_HOST;
        return c;
      } catch (e) {
        return { host: DEFAULT_HOST };
      }
    },
    save: function (c) {
      try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {}
    },
  };

  // Resolves {status, json}; rejects on network error or timeout.
  function http(method, url, body, timeout) {
    return new Promise(function (resolve, reject) {
      var r = new XMLHttpRequest({ mozSystem: true }); // no CORS, any LAN host
      r.open(method, url);
      r.timeout = timeout || 6000;
      if (body != null) r.setRequestHeader("Content-Type", "application/json");
      r.onload = function () {
        var json = null;
        try { json = JSON.parse(r.responseText); } catch (e) {}
        resolve({ status: r.status, json: json });
      };
      r.onerror = function () { reject(new Error("can't reach controller")); };
      r.ontimeout = function () { reject(new Error("timed out")); };
      r.send(body == null ? null : JSON.stringify(body));
    });
  }

  var Api = {
    host: function () { return Store.load().host; },

    // Returns array of {uuid,name,power,dim,dimmable}. Throws on error/offline.
    devices: function () {
      return http("GET", "http://" + Api.host() + "/api/devices").then(function (r) {
        if (r.status !== 200 || !r.json || !r.json.ok) {
          throw new Error((r.json && r.json.error) || ("HTTP " + r.status));
        }
        return r.json.devices;
      });
    },

    control: function (uuid, power) {
      return http("POST", "http://" + Api.host() + "/api/control",
        { uuid: uuid, power: power }).then(function (r) {
        if (r.status !== 200) throw new Error("HTTP " + r.status);
      });
    },

    all: function (power) {
      return http("POST", "http://" + Api.host() + "/api/all",
        { power: power }, 15000).then(function (r) {
        if (r.status !== 200) throw new Error("HTTP " + r.status);
      });
    },
  };

  root.Deako = { Store: Store, Api: Api, DEFAULT_HOST: DEFAULT_HOST };
}(window));
