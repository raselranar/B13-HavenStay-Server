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
  // console.log("line:32", { token, JWKS });
  try {
    const { payload } = await jose.jwtVerify(token, JWKS);

    req.user = payload;
    // console.log("payload", payload);

    next();
  } catch (error) {
    // console.log(error);
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
// verify owner
const verifyOwner = async (req, res, next) => {
  const { user } = req;
  if (user.role !== "owner") {
    return res.status(401).send({ message: "Unauthorized" });
  }
  next();
};

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
    const database = client.db("haven-stay");
    const propertiesCollection = database.collection("properties");
    const favoritesCollection = database.collection("favorites");
    const bookingCollection = database.collection("bookings");

    //  fetch all properties
    app.get("/api/properties", async (req, res) => {
      const query = { status: { $in: ["approved", "Approved"] } };
      if (req.query.search) {
        query.$or = [{ location: { $regex: req.query.search, $options: "i" } }];
      }
      if (req.query.type) {
        query.propertyType = req.query.type;
      }
      let sortOption = {};
      if (req.query.sort === "price_asc") {
        sortOption = { rent: 1 };
      } else if (req.query.sort === "price_desc") {
        sortOption = { rent: -1 };
      }
      if (req.query.minPrice) {
        const minPrice = Number(req.query.minPrice);
        // console.log(minPrice);
        query.rent = { $gte: minPrice };
      }
      if (req.query.maxPrice) {
        const maxPrice = Number(req.query.maxPrice);
        query.rent = { $lte: maxPrice };
      }

      // console.log(query);
      const properties = await propertiesCollection
        .find(query)
        .sort(sortOption)
        .toArray();
      res.send(properties);
    });
    // fetch single property by id
    app.get(
      "/api/properties/details/:id",
      verifyToken,
      verifyTenant,
      async (req, res) => {
        const { id } = req.params;
        const userId = req.query?.userId;
        // console.log("userId", userId);
        const property = await propertiesCollection.findOne({
          _id: new ObjectId(id),
        });
        const isFavorite = await favoritesCollection.findOne({
          userId,
          propertyId: id,
        });
        if (isFavorite) {
          property.isFavorite = true;
        }

        res.send(property);
      },
    );

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
    app.post(
      "/api/properties/favorites",
      verifyToken,
      verifyTenant,
      async (req, res) => {
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
        // update property
        await propertiesCollection.updateOne(
          { _id: new ObjectId(propertyId) },
          { $inc: { favorites: 1 } },
        );
        res.send(favorite);
      },
    );
    // remove form favorites
    app.delete(
      "/api/properties/favorites",
      verifyToken,
      verifyTenant,
      async (req, res) => {
        const { _id } = req.body;
        if (!_id) {
          return res
            .status(400)
            .send({ message: "Missing userId or propertyId" });
        }
        const favorite = await favoritesCollection.deleteOne({
          _id: new ObjectId(_id),
        });
        res.send(favorite);
      },
    );

    // get favorites
    app.get(
      "/api/properties/favorites",
      verifyToken,
      verifyTenant,
      async (req, res) => {
        const { userId } = req.query;
        const favoriteProperties = await favoritesCollection
          .aggregate([
            { $match: { userId: userId } },

            {
              $addFields: {
                propertyObjectId: { $toObjectId: "$propertyId" },
              },
            },

            {
              $lookup: {
                from: "properties",
                localField: "propertyObjectId",
                foreignField: "_id",
                as: "propertyDetails",
              },
            },

            { $unwind: "$propertyDetails" },

            {
              $project: {
                _id: "$_id",
                title: "$propertyDetails.title",
                type: "$propertyDetails.propertyType",
                location: "$propertyDetails.location",
                price: "$propertyDetails.rent",
                beds: "$propertyDetails.bedrooms",
                baths: "$propertyDetails.bathrooms",
              },
            },
          ])
          .toArray();
        // console.log(favoriteProperties);
        res.send(favoriteProperties);
      },
    );

    // tenant review submission
    app.post(
      "/api/properties/reviews",
      verifyToken,
      verifyTenant,
      async (req, res) => {
        const { propertyId, rating, comment } = req.body;
        const user = req.body?.user;
        const reviewerId = user?.session?.userId;
        const reviewerName = user?.user?.name || "Unknown";
        const reviewerEmail = user?.user?.email || "";

        if (!propertyId || !rating || !comment) {
          return res
            .status(400)
            .send({ message: "propertyId, rating, and comment are required" });
        }

        const property = await propertiesCollection.findOne({
          _id: new ObjectId(propertyId),
        });
        if (!property) {
          return res.status(404).send({ message: "Property not found" });
        }

        const review = {
          reviewerId,
          reviewerName,
          reviewerEmail,
          rating: Number(rating),
          comment,
          date: new Date(),
        };

        await propertiesCollection.updateOne(
          { _id: new ObjectId(propertyId) },
          { $push: { reviews: review } },
        );

        res.send({ review });
      },
    );

    // add booking
    app.post(
      "/api/properties/bookings",
      verifyToken,
      verifyTenant,
      async (req, res) => {
        const { userId, propertyId } = req.body;
        const data = req.body;

        // console.log(data);
        if (!userId || !propertyId) {
          return res
            .status(400)
            .send({ message: "Missing userId or propertyId" });
        }
        const booking = await bookingCollection.insertOne({
          ...data,
          createdAt: new Date(),
        });
        res.send(booking);
      },
    );

    // get bookings
    app.get(
      "/api/properties/bookings",
      verifyToken,
      verifyTenant,
      async (req, res) => {
        const query = {};
        const { userId } = req.body.session;
        const transactionId = req.body.transactionId;
        console.log(transactionId);
        if (transactionId) query.transactionId = transactionId;

        if (!userId) {
          return res.status(400).send({ message: "Missing userId" });
        }
        query.userId = userId;
        const bookings = await bookingCollection.find(query).toArray();
        res.send(bookings);
      },
    );
    // get bookings
    app.get(
      "/api/properties/bookings",
      verifyToken,
      verifyOwner,
      async (req, res) => {
        const query = {};
        const { userId } = req.body.session;
        const stripId = req.query.stripId;
        if (stripId) query.stripId = stripId;

        if (!userId) {
          return res.status(400).send({ message: "Missing userId" });
        }
        query.userId = userId;
        const bookings = await bookingCollection.find(query).toArray();
        res.send(bookings);
      },
    );

    // get analytics data
    app.get(
      "/api/properties/tenant-analytics",
      verifyToken,
      verifyTenant,
      async (req, res) => {
        const { userId } = req.body?.session;
        if (!userId) {
          return res.status(400).send({ message: "Missing userId" });
        }
        const totalBookings = bookingCollection.countDocuments({
          userId: userId,
        });
        const totalFavorites = favoritesCollection.countDocuments({
          userId: userId,
        });
        const totalActiveRentals = bookingCollection.countDocuments({
          userId: userId,
          bookingStatus: "confirmed",
        });
        const [bookingsCount, favoritesCount, activeRentalsCount] =
          await Promise.all([
            totalBookings,
            totalFavorites,
            totalActiveRentals,
          ]);

        res.send({
          bookingsCount,
          favoritesCount,
          activeRentalsCount,
        });
      },
    );

    // owner routes
    // add property
    app.post(
      "/api/owner/properties",
      verifyToken,
      verifyOwner,
      async (req, res) => {
        const data = req.body;
        const property = await propertiesCollection.insertOne({
          ...data,
          createdAt: new Date(),
        });
        res.send(property);
      },
    );

    // get properties
    app.get(
      "/api/owner/properties/:ownerId",
      verifyToken,
      verifyOwner,
      async (req, res) => {
        const ownerId = req.params.ownerId;
        const query = {
          "ownerInfo.ownerId": ownerId,
        };
        const properties = await propertiesCollection.find(query).toArray();
        res.send(properties);
      },
    );

    // get owner booking requests
    app.get(
      "/api/owner/bookings/:ownerId",
      verifyToken,
      verifyOwner,
      async (req, res) => {
        const ownerId = req.params.ownerId;
        const bookings = await bookingCollection
          .find({ "ownerInfo.ownerId": ownerId })
          .toArray();
        console.log({ bookings });
        res.send(bookings);
      },
    );

    // update booking status for owner
    app.put(
      "/api/owner/bookings",
      verifyToken,
      verifyOwner,
      async (req, res) => {
        const { id, bookingStatus } = req.body;
        if (!id || !bookingStatus) {
          return res
            .status(400)
            .send({ message: "Missing id or bookingStatus" });
        }

        const booking = await bookingCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!booking) {
          return res.status(404).send({ message: "Booking not found" });
        }

        const updated = await bookingCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { bookingStatus, updatedAt: new Date() } },
        );

        if (updated.matchedCount === 0) {
          return res.status(404).send({ message: "Booking not found" });
        }

        res.send({ success: true, bookingStatus });
      },
    );

    // update properties by id
    app.put(
      "/api/owner/properties/:id",
      verifyToken,
      verifyOwner,
      async (req, res) => {
        const id = req.params.id;
        const { _id, ...updateData } = req.body;

        const property = await propertiesCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!property) {
          return res.status(404).send({ message: "Property not found" });
        }
        const updatedProperty = await propertiesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData },
        );
        res.send(updatedProperty);
      },
    );
    // delete property by id
    app.delete("/api/owner/properties", async (req, res) => {
      const id = req.body.id;
      console.log({ id });
      const result = await propertiesCollection.deleteOne({
        _id: new ObjectId(id),
      });
      if (result.deletedCount < 1) {
        return res.status(404).send({ message: "Property not found" });
      }
      console.log({ result });
      res.send(result);
    });

    // get analytics data
    app.get(
      "/api/owner/analytics",
      verifyToken,
      verifyOwner,
      async (req, res) => {
        const { userId } = req.body?.session;
        if (!userId) {
          return res.status(400).send({ message: "Missing userId" });
        }
        const totalEarningsResult = await bookingCollection
          .aggregate([
            {
              $match: {
                paymentStatus: "paid",
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: { $toDouble: "$rent" } },
              },
            },
          ])
          .toArray();
        const totalEarningsSum = totalEarningsResult[0]?.total || 0;
        const propertiesCount = propertiesCollection.countDocuments({
          "ownerInfo.ownerId": userId,
        });
        const bookingsCount = bookingCollection.countDocuments({
          userId: userId,
          bookingStatus: "approved",
        });
        const [totalEarnings, totalProperties, totalBookings] =
          await Promise.all([totalEarningsSum, propertiesCount, bookingsCount]);

        res.send({
          totalEarnings,
          totalProperties,
          totalBookings,
        });
      },
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
