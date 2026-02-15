import { asyncHandler } from "../utils/asyncHandler.js";
import ApiErrors from "../utils/ApiErrors.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResopnse.js";

// Function to generate both Access Token and Refresh Token for a user
const generateAccessTokenAndRefreshToken = async (userId) => {
  try {
    // 👤 Find the user in database using userId
    const user = await User.findById(userId);

    // 🔑 Create Access Token (short-lived, used for API requests)
    const accessToken = user.generateAccessToken();

    // 🔄 Create Refresh Token (long-lived, used to get new access token)
    const refreshToken = user.generateRefreshToken();

    // 💾 Save refresh token in database
    // This helps to verify it later and allows logout from all devices
    user.refreshToken = refreshToken;

    // ⚡ Save user without running validations
    // (because we are only updating refreshToken field)
    await user.save({ validateBeforeSave: false });

    // ✅ Return both tokens
    return { accessToken, refreshToken };
  } catch (error) {
    // ❌ If anything goes wrong → throw server error
    console.log(error); // 👈 ADD THIS
    throw new ApiErrors(500, "Internal server error while generating tokens");
  }
};

//*************************************************Register Controller***************************************************************** */
// 📝 Register User Controller (Create new account)
const registerUser = asyncHandler(async (req, res) => {
  // 📨 Get user data from request body
  const { email, password, fullname, username } = req.body;

  // ❌ Validate input — all fields must be filled
  if ([fullname, email, username, password].some((f) => f?.trim() === "")) {
    throw new ApiErrors(400, "All fields are required");
  }

  // 🔎 Check if user already exists (by username OR email)
  const existedUser = await User.findOne({
    $or: [{ username }, { email }],
  });

  // ❌ If user already exists → cannot register again
  if (existedUser) {
    throw new ApiErrors(409, "User already exists");
  }

  // 📁 Get uploaded file paths from request (via multer)
  const avatarLocalPath = req.files?.avatar?.[0]?.path;

  const coverImageLocalPath = req.files?.coverImage?.[0]?.path;

  // ❌ Avatar is required
  if (!avatarLocalPath) {
    throw new ApiErrors(400, "Avatar file is required");
  }

  console.log("Avatar:", avatarLocalPath);
  console.log("Cover:", coverImageLocalPath);

  // ☁️ Upload avatar to Cloudinary (required)
  const avatar = await uploadOnCloudinary(avatarLocalPath);

  // ☁️ Upload cover image to Cloudinary (optional)
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);

  // ❌ If avatar upload fails → stop registration
  if (!avatar) {
    throw new ApiErrors(400, "Avatar upload failed");
  }

  // ✅ Create new user in database
  const user = await User.create({
    fullname,
    avatar: avatar.url, // store avatar URL
    coverImage: coverImage?.url || "", // optional
    email,
    password, // will be hashed in model
    username: username.toLowerCase(), // normalize username
  });

  // 🔒 Get created user without sensitive fields
  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken",
  );

  // ❌ If something went wrong while saving
  if (!createdUser) {
    throw new ApiErrors(500, "User registration failed");
  }

  // ✅ Send success response
  return res
    .status(201)
    .json(new ApiResponse(201, createdUser, "User registered successfully"));
});

//*************************************************Login Controller***************************************************************** */

// 🔐 Login User Controller
const LoginUser = asyncHandler(async (req, res) => {
  // 📨 Get login data from request body
  const { email, username, password } = req.body;

  // ❌ Validate required fields (user must provide username or email)
  if (!(username || email)) {
    throw new ApiErrors(400, "username or email is required");
  }

  // 🔎 Find user in database using username OR email
  const user = await User.findOne({
    $or: [{ username }, { email }],
  });

  // ❌ If user not found → account does not exist
  if (!user) {
    throw new ApiErrors(404, "user does not exists");
  }

  // 🔑 Verify password (compare entered password with stored hashed password)
  const isPasswordCorrect = await user.isPasswordCorrect(password);

  // ❌ If password is wrong → deny login
  if (!isPasswordCorrect) {
    throw new ApiErrors(401, "invalid password");
  }

  // 🎫 Generate Access Token + Refresh Token for authenticated user
  const { accessToken, refreshToken } =
    await generateAccessTokenAndRefreshToken(user._id);

  // 👤 Get safe user data (exclude sensitive fields)
  const LoggedInUser = await User.findById(user._id).select(
    "-password -refreshToken",
  );

  // 🍪 Cookie options for security
  const options = {
    httpOnly: true, // Prevents JavaScript access (protects from XSS)
    secure: true, // Cookie sent only over HTTPS
  };

  // ✅ Send tokens in cookies + send response
  return (
    res
      .status(200)

      // Store Access Token in browser cookie
      .cookie("accessToken", accessToken, options)

      // Store Refresh Token in browser cookie
      .cookie("refreshToken", refreshToken, options)

      // Send success response with user data and tokens
      .json(
        new ApiResponse(
          200,
          {
            user: LoggedInUser,
            accessToken,
            refreshToken,
          },
          "user logged in successfully",
        ),
      )
  );
});

//*************************************************Loggout Controller**************************************************************
const LoggedOutUser = asyncHandler(async (req, res) => {
  // 🔎 Find the logged-in user by ID (comes from auth middleware)
  // and remove the stored refresh token from database
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: {
        refreshToken: undefined, // ❌ Invalidate refresh token (user cannot get new access tokens)
      },
    },
    {
      new: true, // 👉 Return updated document (not strictly needed here)
    },
  );

  // 🍪 Cookie options — must match options used while setting cookies
  const options = {
    httpOnly: true, // 🔐 Prevents access from JavaScript (protects from XSS attacks)
    secure: true, // 🔒 Cookie sent only over HTTPS (required in production)
  };

  // 🚪 Clear both tokens from browser cookies
  return res
    .status(200)
    .clearCookie("accessToken", options) // ❌ Remove access token cookie
    .clearCookie("refreshToken", options) // ❌ Remove refresh token cookie
    .json(new ApiResponse(200, {}, "User logged out successfully"));
});

export { registerUser, LoginUser, LoggedOutUser };
