require('dotenv').config();
const express = require('express');
const path = require('path');
const itemsRouter = require('./routes/items');
const outfitsRouter = require('./routes/outfits');
const uploadRouter = require('./routes/upload');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve the web frontend
app.use(express.static(path.join(__dirname, 'public')));

// Parse incoming JSON request bodies
app.use(express.json());

// Mount clothing item routes (includes /items/search)
app.use('/items', itemsRouter);

// Mount outfit builder routes
app.use('/outfits', outfitsRouter);

// Mount camera/image upload route (Claude Vision analysis)
app.use('/upload', uploadRouter);


app.listen(PORT, () => {
  console.log(`Closet app running at http://localhost:${PORT}`);
});
