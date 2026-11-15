// PM2 process file for the VPS.  Usage:  pm2 start ecosystem.config.cjs
// Environment variables come from the .env file in this directory
// (Next.js loads it at startup); keep that file readable only by the app user.
module.exports = {
  apps: [
    {
      name: "benuuprint-erp",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      // Listen on localhost only — Caddy is the only public entry point.
      args: "start -H 127.0.0.1 -p 3000",
      // One process in fork mode. Several instances would need a shared
      // NEXT_SERVER_ACTIONS_ENCRYPTION_KEY (see the Next.js self-hosting docs).
      exec_mode: "fork",
      instances: 1,
      env: { NODE_ENV: "production" },
      max_memory_restart: "700M",
      time: true,
    },
  ],
};
