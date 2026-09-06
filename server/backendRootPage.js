function buildBackendRootPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>My AI PA API</title>
  </head>
  <body>
    <main>
      <h1>My AI PA service is online.</h1>
      <p>This address runs the secure backend and Stripe integration. It is not the customer website.</p>
      <p><a href="https://www.myaipa.ca/">Open My AI PA</a></p>
    </main>
  </body>
</html>`;
}

module.exports = { buildBackendRootPage };
