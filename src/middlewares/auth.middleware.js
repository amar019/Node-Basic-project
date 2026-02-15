import ApiErrors from "../utils/ApiErrors.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
import { User } from "../models/user.model.js";

// Middleware to verify JWT and protect private routes
export const verifyJWT = asyncHandler(async (req, res, next) => {
  try {
    // 🔎 Try to get access token from:
    // 1) Cookies (stored in browser)
    // 2) Authorization header (Bearer token)
    const token =
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", "");

    // ❌ If no token found → user is not logged in
    if (!token) {
      throw new ApiErrors(401, "Unauthorized user (No token)");
    }

    // 🔐 Verify token using secret key
    // If token is fake, modified, or expired → jwt.verify will throw error
    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    // 👤 Get user from database using ID stored inside token
    // Exclude sensitive fields (password, refreshToken)
    const user = await User.findById(decodedToken?._id).select(
      "-password -refreshToken",
    );

    // ❌ If user not found → token invalid or user deleted
    if (!user) {
      throw new ApiErrors(401, "Invalid access token (User not found)");
    }

    // ✅ Attach user data to request object
    // Now next controllers can access logged-in user via req.user
    req.user = user;

    // ➡️ Allow request to continue to next middleware/controller
    next();
  } catch (error) {
    throw new ApiErrors(401, error?.message || "invalid access Token");
  }
});
