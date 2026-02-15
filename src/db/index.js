import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI); // <- no extra options
    console.log("MongoDB connected !!");
  } catch (err) {
    console.error("MongoDB connection error ❌", err);
    process.exit(1);
  }
};

export default connectDB;
