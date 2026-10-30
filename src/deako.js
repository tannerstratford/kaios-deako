// Deako backends + unified facade.
//
// Two ways to reach the lights:
//   TCP  — the phone opens a raw socket straight to the Deako gateway switch
//          (192.168.1.59:23) and speaks Deako's local JSON protocol itself.
//          Standalone: no computer needed. Needs the `tcp-socket` permission
//          and navigator.mozTCPSocket (KaiOS privileged app).
//   HTTP — the phone calls the controller (app.py on a computer) over HTTP.
//          Fallback for when TCP isn't available/reachable.
//
// window.Deako exposes connect()/devices()/control()/all() and routes to
// whichever backend is active. app.js doesn't care which one answered.
(function (root) {
  "use strict";

  var DEFAULT_GATEWAY = "192.168.1.59:23";
  var DEFAULT_HOST = "192.168.1.60:8099";
  var KEY = "deako.cfg";

  var Store = {
    load: function () {
      var c = {};
      try { c = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) {}
      if (!c.gateway) c.gateway = DEFAULT_GATEWAY;
      if (!c.host) c.host = DEFAULT_HOST;
      if (!c.mode) c.mode = "auto"; // auto | tcp | http
      return c;
    },
    save: function (c) {
      try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {}
    },
  };

  function uuid4() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // ---------------------------------------------------------------- TCP backend

  // Speaks the same wire protocol as pydeako: newline-delimited JSON over TCP.
  //   -> {type:"DEVICE_LIST"|"CONTROL"|"PING", dst:"deako", src, transactionId, data?}
  //   <- DEVICE_LIST {data:{number_of_devices}}, DEVICE_FOUND {data:{name,uuid,state,capabilities}},
  //      EVENT {data:{target,state}}, PING (pong)
  var Tcp = {
    SRC: "kaios-deako",
    DST: "deako",
    sock: null,
    open: false,
    buffer: "",
    devices: {},      // uuid -> {uuid,name,power,dim,dimmable}
    expected: 0,
    ping: null,
    onEvent: null,    // called when a device's state changes (live)

    available: function () {
      return "mozTCPSocket" in navigator;
    },

    diag: "",   // last connect diagnostic, shown in Menu > Diagnostics

    connect: function (gateway) {
      var self = this;
      return new Promise(function (resolve, reject) {
        self.diag = "mozTCPSocket in navigator: " + ("mozTCPSocket" in navigator) +
          "\nnavigator.b2g: " + (typeof navigator.b2g) +
          "\nb2g.TCPSocket: " + (navigator.b2g ? typeof navigator.b2g.TCPSocket : "n/a");
        if (!self.available()) return reject(new Error("mozTCPSocket API not present"));
        var parts = gateway.split(":");
        var host = parts[0], port = parseInt(parts[1] || "23", 10);

        // Open robustly: try the 3-arg options form, then 2-arg + binaryType prop.
        self._reset();
        try {
          self.sock = navigator.mozTCPSocket.open(host, port, { binaryType: "string" });
        } catch (e1) {
          try {
            self.sock = navigator.mozTCPSocket.open(host, port);
            try { self.sock.binaryType = "string"; } catch (e) {}
          } catch (e2) {
            self.diag += "\nopen() threw: " + e1.message + " / " + e2.message;
            return reject(new Error("open() threw: " + e2.message));
          }
        }
        if (!self.sock) { self.diag += "\nopen() returned null"; return reject(new Error("open() returned null")); }
        self.diag += "\nopen() ok, readyState=" + self.sock.readyState;

        var settled = false;
        var t = setTimeout(function () {
          if (settled) return;
          settled = true;
          var rs = self.sock && self.sock.readyState;
          self.diag += "\nno onopen/onerror in 7s, readyState=" + rs;
          reject(new Error("connect timed out (readyState=" + rs + ")"));
        }, 7000);

        self.sock.onopen = function () {
          self.open = true;
          clearTimeout(t);
          self.diag += "\nonopen fired";
          self._startPing();
          if (!settled) { settled = true; resolve(); }
        };
        self.sock.ondata = function (e) { self._onData(e.data); };
        self.sock.onerror = function (e) {
          self.open = false;
          var name = (e && e.data && (e.data.name || e.data.message)) || (e && e.name) || "socket error";
          self.diag += "\nonerror: " + name;
          clearTimeout(t);
          if (!settled) { settled = true; reject(new Error("socket error: " + name)); }
        };
        self.sock.onclose = function () {
          self.open = false;
          self._stopPing();
        };
      });
    },

    _reset: function () {
      this._stopPing();
      try { if (this.sock) this.sock.close(); } catch (e) {}
      this.sock = null; this.open = false; this.buffer = "";
      this.devices = {}; this.expected = 0;
    },

    disconnect: function () { this._reset(); },

    _send: function (body) {
      if (!this.sock || !this.open) throw new Error("not connected");
      body.transactionId = uuid4();
      body.dst = this.DST;
      body.src = this.SRC;
      this.sock.send(JSON.stringify(body)); // pydeako sends raw json, no delimiter
    },

    _startPing: function () {
      var self = this;
      self._stopPing();
      self.ping = setInterval(function () {
        try { self._send({ type: "PING" }); } catch (e) {}
      }, 5000);
    },
    _stopPing: function () { if (this.ping) { clearInterval(this.ping); this.ping = null; } },

    // Responses may arrive split across packets or several per packet; frames
    // are \r\n-delimited JSON. Buffer until each frame parses.
    _onData: function (chunk) {
      this.buffer += chunk;
      var parts = this.buffer.split("\r\n");
      this.buffer = parts.pop(); // last piece may be incomplete
      for (var i = 0; i < parts.length; i++) {
        var line = parts[i].trim();
        if (!line) continue;
        var msg;
        try { msg = JSON.parse(line); } catch (e) { this.buffer = line + this.buffer; continue; }
        this._handle(msg);
      }
      // a single complete frame with no trailing \r\n
      if (this.buffer) {
        try { var m = JSON.parse(this.buffer); this.buffer = ""; this._handle(m); } catch (e) {}
      }
    },

    _handle: function (msg) {
      var t = msg.type, d = msg.data || {};
      if (t === "DEVICE_LIST") {
        this.expected = d.number_of_devices || 0;
      } else if (t === "DEVICE_FOUND") {
        var st = d.state || {};
        var dimmable = d.capabilities ? d.capabilities.indexOf("dim") !== -1 : (st.dim != null);
        this.devices[d.uuid] = {
          uuid: d.uuid, name: (d.name || "Unknown").trim(),
          power: !!st.power, dim: st.dim == null ? null : st.dim, dimmable: dimmable,
        };
      } else if (t === "EVENT") {
        var dev = this.devices[d.target];
        if (dev) {
          var s = d.state || {};
          dev.power = !!s.power;
          if (s.dim != null) dev.dim = s.dim;
          if (this.onEvent) this.onEvent();
        }
      }
      // PING/pong: ignore
    },

    // Request the device list, resolve the collected array.
    refresh: function () {
      var self = this;
      return new Promise(function (resolve, reject) {
        try { self.expected = 0; self.devices = {}; self._send({ type: "DEVICE_LIST" }); }
        catch (e) { return reject(e); }
        var waited = 0, step = 300, cap = 8000;
        var iv = setInterval(function () {
          waited += step;
          var got = Object.keys(self.devices).length;
          var done = self.expected > 0 && got >= self.expected;
          if (done || waited >= cap) {
            clearInterval(iv);
            if (got === 0) return reject(new Error("no devices (gateway reachable?)"));
            resolve(self._list());
          }
        }, step);
      });
    },

    _list: function () {
      var out = [];
      for (var k in this.devices) out.push(this.devices[k]);
      out.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
      return out;
    },

    devices: function () {
      // if we already have a live list, return it; else do a refresh
      return Object.keys(this.devices).length ? Promise.resolve(this._list()) : this.refresh();
    },

    control: function (uuid, power) {
      var self = this;
      return new Promise(function (resolve, reject) {
        try {
          self._send({ type: "CONTROL", data: { target: uuid, state: { power: power } } });
          if (self.devices[uuid]) self.devices[uuid].power = power;
          resolve();
        } catch (e) { reject(e); }
      });
    },

    all: function (power) {
      var self = this, ids = Object.keys(self.devices);
      return new Promise(function (resolve) {
        var i = 0;
        (function step() {
          if (i >= ids.length) return resolve();
          try { self._send({ type: "CONTROL", data: { target: ids[i], state: { power: power } } });
            self.devices[ids[i]].power = power; } catch (e) {}
          i++;
          setTimeout(step, 60);
        })();
      });
    },
  };

  // ---------------------------------------------------------------- HTTP backend (fallback)

  function xhr(method, url, body, timeout) {
    return new Promise(function (resolve, reject) {
      var r = new XMLHttpRequest({ mozSystem: true });
      r.open(method, url);
      r.timeout = timeout || 6000;
      if (body != null) r.setRequestHeader("Content-Type", "application/json");
      r.onload = function () {
        var j = null; try { j = JSON.parse(r.responseText); } catch (e) {}
        resolve({ status: r.status, json: j });
      };
      r.onerror = function () { reject(new Error("can't reach controller")); };
      r.ontimeout = function () { reject(new Error("timed out")); };
      r.send(body == null ? null : JSON.stringify(body));
    });
  }

  var Http = {
    host: DEFAULT_HOST,
    connect: function (host) {
      this.host = host;
      return this.devices().then(function () {}); // a successful list == connected
    },
    devices: function () {
      return xhr("GET", "http://" + this.host + "/api/devices").then(function (r) {
        if (r.status !== 200 || !r.json || !r.json.ok) throw new Error((r.json && r.json.error) || ("HTTP " + r.status));
        return r.json.devices;
      });
    },
    control: function (uuid, power) {
      return xhr("POST", "http://" + this.host + "/api/control", { uuid: uuid, power: power })
        .then(function (r) { if (r.status !== 200) throw new Error("HTTP " + r.status); });
    },
    all: function (power) {
      return xhr("POST", "http://" + this.host + "/api/all", { power: power }, 15000)
        .then(function (r) { if (r.status !== 200) throw new Error("HTTP " + r.status); });
    },
  };

  // ---------------------------------------------------------------- facade

  var active = null;   // "tcp" | "http"
  var onEvent = null;

  var Deako = {
    Store: Store,
    DEFAULT_GATEWAY: DEFAULT_GATEWAY,
    DEFAULT_HOST: DEFAULT_HOST,

    mode: function () { return active; },
    diag: function () { return Tcp.diag || "(no TCP attempt yet)"; },
    label: function () {
      var c = Store.load();
      return active === "tcp" ? ("direct " + c.gateway) : active === "http" ? ("via " + c.host) : "not connected";
    },

    set onEvent(fn) { onEvent = fn; Tcp.onEvent = fn; },
    get onEvent() { return onEvent; },

    // Connect per config. auto: try TCP then HTTP. Resolves with the mode used.
    connect: function () {
      var c = Store.load();
      var tryTcp = (c.mode === "tcp" || c.mode === "auto") && Tcp.available();
      var tryHttp = (c.mode === "http" || c.mode === "auto");

      var p = Promise.reject(new Error("no backend"));
      if (tryTcp) {
        p = Tcp.connect(c.gateway).then(function () { return Tcp.refresh(); })
          .then(function () { active = "tcp"; return "tcp"; });
      }
      if (tryHttp) {
        p = p.catch(function (tcpErr) {
          return Http.connect(c.host).then(function () { active = "http"; return "http"; })
            .catch(function (httpErr) {
              throw new Error(tryTcp ? ("TCP: " + tcpErr.message + " / HTTP: " + httpErr.message) : httpErr.message);
            });
        });
      }
      return p;
    },

    _backend: function () { return active === "tcp" ? Tcp : active === "http" ? Http : null; },

    devices: function () {
      var b = this._backend();
      return b ? b.devices() : Promise.reject(new Error("not connected"));
    },
    control: function (uuid, power) {
      var b = this._backend();
      return b ? b.control(uuid, power) : Promise.reject(new Error("not connected"));
    },
    all: function (power) {
      var b = this._backend();
      return b ? b.all(power) : Promise.reject(new Error("not connected"));
    },
  };

  root.Deako = Deako;
}(window));
