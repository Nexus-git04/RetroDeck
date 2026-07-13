const { app, BrowserWindow } = require("electron");
const path = require("path");
const { fork } = require("child_process");
const http = require("http");

let server;

function waitForServer(callback) {
  const check = () => {
    http.get("http://localhost:3000", () => {
      callback();
    }).on("error", () => {
      setTimeout(check, 300);
    });
  };
  check();
}

function createWindow() {
  server = fork(path.join(__dirname, "server.js"));

  waitForServer(() => {
    const win = new BrowserWindow({
      width: 1280,
      height: 720,
      autoHideMenuBar: true
    });

    win.loadURL("http://localhost:3000");
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (server) server.kill();
  app.quit();
});