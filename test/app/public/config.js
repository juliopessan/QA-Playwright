// Usuários aceitos pelo app de teste. O build web (npm run build:web) gera outro config.js com credenciais novas.
window.APP_CONFIG = {
  users: { standard_user: "secret_sauce", locked_out_user: "secret_sauce" },
  locked: ["locked_out_user"],
};
