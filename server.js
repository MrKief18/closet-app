const express = require('express');
const itemsRouter = require('./routes/items');
const outfitsRouter = require('./routes/outfits');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse incoming JSON request bodies
app.use(express.json());

// Mount clothing item routes
app.use('/items', itemsRouter);

// Mount outfit builder routes
app.use('/outfits', outfitsRouter);

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Closet API is running', version: '1.0.0' });
});

app.listen(PORT, () => {
  console.log(`Closet app running at http://localhost:${PORT}`);
});
