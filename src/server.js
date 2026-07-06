const app = require('./app');
const { connectDb } = require('./db/mongoose');

const port = Number(process.env.PORT || 3000);

connectDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`Service CRM Admin running on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to connect MongoDB. Check MONGODB_URI in .env and make sure MongoDB is running.');
    console.error(error.message);
    process.exit(1);
  });
