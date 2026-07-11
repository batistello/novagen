module.exports = {
  apps: [
    {
      name: 'artificial-genesis-backend',
      cwd: './backend',
      script: 'node_modules/.bin/ts-node',
      args: '--transpile-only src/runner.ts',
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
    },
    {
      name: 'artificial-genesis-frontend',
      cwd: './frontend',
      script: 'python3',
      args: '-m http.server 8090',
      autorestart: true,
    },
  ],
};
