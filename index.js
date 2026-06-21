import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import * as jose from "jose";
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
const JWKS = jose.createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "Unauthorized" });
  }
  console.log("line:32", { token, JWKS });
  try {
    const { payload } = await jose.jwtVerify(token, JWKS);

    req.user = payload;
    console.log("payload", payload);

    next();
  } catch (error) {
    console.log(error);
    return res.status(401).send({ message: "Unauthorized" });
  }
};

// verify tenant
const verifyTenant = async (req, res, next) => {
  const { user } = req;
  if (user.role !== "tenant") {
    return res.status(401).send({ message: "Unauthorized" });
  }
  next();
};

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
    const favoritesCollection = database.collection("favorites");

    //  fetch all properties
    app.get("/api/properties", verifyToken, verifyTenant, async (req, res) => {
      console.log(req.headers);
      const properties = await propertiesCollection.find().toArray();
      res.send(properties);
    });
    // fetch single property by id
    app.get("/api/properties/details/:id", async (req, res) => {
      const { id } = req.params;
      const property = await propertiesCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(property);
    });

    // Featured Properties
    app.get("/api/properties/featured", async (req, res) => {
      const featuredProperties = await propertiesCollection
        .find({ status: "Approved" })
        .limit(6)
        .toArray();
      res.send(featuredProperties);
    });
    // Recently Added Properties
    app.get("/api/properties/recent", async (req, res) => {
      const recentProperties = await propertiesCollection
        .find({ status: "Approved" })
        .sort({ createdAt: -1 })
        .limit(3)
        .toArray();
      res.send(recentProperties);
    });
    // Add to favorites
    app.post("/api/properties/favorites", async (req, res) => {
      const { userId, propertyId } = req.body;
      if (!userId || !propertyId) {
        return res
          .status(400)
          .send({ message: "Missing userId or propertyId" });
      }
      const favorite = await favoritesCollection.insertOne({
        userId,
        propertyId,
        createdAt: new Date(),
      });
      res.send(favorite);
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
