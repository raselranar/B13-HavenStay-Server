import { MongoClient, ServerApiVersion } from "mongodb";
import express from "express";
import cors from "cors";
import "dotenv/config";
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(cors());
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
    const database = client.db("haven-stay");
    const propertiesCollection = database.collection("properties");

    //  fetch all properties
    app.get("/api/properties", async (req, res) => {
      const properties = await propertiesCollection.find().toArray();
      res.send(properties);
    });

    // Featured Properties
    app.get("/api/properties/featured", async (req, res) => {
      const featuredProperties = await propertiesCollection
        .find({ status: "Approved" })
        .limit(6)
        .toArray();
      res.send(featuredProperties);
    });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
