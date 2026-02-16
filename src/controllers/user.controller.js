import { asyncHandler } from "../utils/asyncHandler.js";
import ApiErrors from "../utils/ApiErrors.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResopnse.js";
import jwt from "jsonwebtoken";

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

//******************************************************************************************************************** */
// Refresh JWT access token using the refresh token
const refreshAccessToken = asyncHandler(async (req, res) => {
  // 🔹 Get refresh token from cookies or request body
  const incomingRefreshToken =
    req.cookies.refreshToken || req.body.refreshToken;

  // ❌ Check: token must exist
  if (!incomingRefreshToken) {
    throw new ApiErrors(401, "unauthorized request");
  }

  try {
    // 🔹 Verify refresh token using REFRESH_TOKEN_SECRET
    const decodeToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET,
    );

    // 🔹 Find the user corresponding to this token
    const user = await User.findById(decodeToken?._id);

    if (!user) {
      throw new ApiErrors(401, "invalid refresh token");
    }

    // 🔹 Make sure the token matches the one saved in DB
    if (incomingRefreshToken !== user?.refreshToken) {
      throw new ApiErrors(401, "refresh token is expired or invalid");
    }

    const options = {
      httpOnly: true, // 🔐 Cookie cannot be accessed by JS
      secure: true, // 🔒 Only sent over HTTPS
    };

    // 🔹 Generate new access token and refresh token
    const { accessToken, newRefreshToken } =
      await generateAccessTokenAndRefreshToken(user?._id);

    // 🔹 Send new tokens in cookies and response
    return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", newRefreshToken, options)
      .json(
        new ApiResponse(
          200,
          { accessToken, refreshToken: newRefreshToken },
          "Access token refreshed successfully",
        ),
      );
  } catch (error) {
    // 🔹 If token is invalid/expired, return 401
    throw new ApiErrors(401, error?.message || "invalid refresh token");
  }
});

// ********************************* CHANGE CURRENT PASSWORD ***********************************

const changeCurrentPassword = asyncHandler(async (req, res) => {
  // 🔹 Get old and new password from request body
  const { oldPassword, newPassword } = req.body;

  // 🔹 Find the currently logged-in user from database
  // req.user._id comes from verifyJWT middleware
  const user = await User.findById(req.user?._id);

  // 🔹 Check if the old password entered is correct
  // isPasswordCorrect() compares entered password with hashed password in DB
  const isPsswordCorrect = await user.isPasswordCorrect(oldPassword);

  // ❌ If old password is wrong → stop here
  if (!isPsswordCorrect) {
    throw new ApiErrors(400, "invalid old password");
  }

  // 🔹 Set new password
  // It will be hashed automatically by pre("save") middleware
  user.password = newPassword;

  // 🔹 Save updated password to database
  // validateBeforeSave:false → skip other validations
  await user.save({ validateBeforeSave: false });

  // ✅ Send success response
  return res
    .status(200)
    .json(new ApiResponse(200, {}, "password changed succesfully"));
});

// ************************ GET CURRENT LOGGED-IN USER ************************
//used for profile / Dashboard /Navbar / pages

const getCurrentUser = asyncHandler(async (req, res) => {
  // 🔹 req.user contains authenticated user's data
  // This data was attached by verifyJWT middleware
  // after verifying the access token

  return res
    .status(200) // ✅ HTTP status code: OK (request successful)

    .json(
      new ApiResponse(
        200, // 🔹 Custom status code inside response body
        req.user, // 🔹 Send current user's data
        "Current user fetched successfully", // 🔹 Success message
      ),
    );
});

// ************************ UPDATE ACCOUNT DETAILS ************************

const updateAccountDetails = asyncHandler(async (req, res) => {
  // 🔹 Get new details from request body
  const { fullname, email } = req.body;

  // 🔹 Validate input (both fields required)
  if (!fullname || !email) {
    throw new ApiErrors(400, "All fields are required");
  }

  // 🔹 Update the logged-in user's data in DB
  // req.user._id comes from verifyJWT middleware

  const user = await User.findByIdAndUpdate(
    req.user?._id, // 🔹 ID of currently authenticated user

    {
      $set: {
        fullname: fullname, // 🔹 Update fullname
        email: email, // 🔹 Update email
      },
    },

    {
      new: true, // 🔹 Return updated document (not old one)
    },
  ).select("-password"); // 🔹 Exclude password from response

  // 🔹 Send success response with updated user data
  return res.status(200).json(
    new ApiResponse(
      200,
      user, // 🔹 Updated user info
      "Account details updated successfully",
    ),
  );
});

// ****************************Controller to update the logged-in user's avatar (profile image)**********************
const updateUserAvatar = asyncHandler(async (req, res) => {
  // 1️⃣ Get the local file path of uploaded image
  // req.file is added by Multer middleware after file upload
  const avatarLocalPath = req.file?.path;

  // 2️⃣ Validate that a file was actually uploaded
  if (!avatarLocalPath) {
    throw new ApiErrors(400, "Avatar file is missing");
  }

  // 3️⃣ Upload the image from local storage to Cloudinary
  // This returns an object containing image URL and metadata
  const avatar = await uploadOnCloudinary(avatarLocalPath);

  // 4️⃣ Ensure Cloudinary upload was successful
  if (!avatar.url) {
    throw new ApiErrors(400, "Error while uploading on avatar");
  }

  // 5️⃣ Update the user's avatar URL in the database
  // req.user._id comes from JWT authentication middleware
  const updatedUser = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        avatar: avatar.url, // Save Cloudinary image URL
      },
    },
    { new: true }, // Return updated document instead of old one
  ).select("-password"); // Exclude password field from response

  // 6️⃣ Send success response with updated user data
  return res
    .status(200)
    .json(new ApiResponse(200, updatedUser, "Avatar updated successfully"));
});
// Controller to update the logged-in user's cover image (profile banner)
const updateUserCoverImage = asyncHandler(async (req, res) => {

  // 1️⃣ Get local file path of uploaded cover image
  // req.file is populated by Multer middleware
  const coverImageLocalPath = req.file?.path;

  // 2️⃣ Validate that a file was uploaded
  if (!coverImageLocalPath) {
    throw new ApiErrors(400, "Cover image file is missing");
  }

  // 3️⃣ Upload image to Cloudinary (cloud storage)
  // Returns object containing secure URL and metadata
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);

  // 4️⃣ Ensure upload succeeded
  if (!coverImage.url) {
    throw new ApiErrors(400, "Error while uploading cover image");
  }

  // 5️⃣ Update user's cover image URL in database
  // req.user._id comes from authentication middleware (JWT verified user)
  const updatedUser = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        coverImage: coverImage.url, // Save Cloudinary URL
      },
    },
    { new: true }, // Return updated document
  ).select("-password"); // Exclude sensitive data

  // 6️⃣ Send success response with updated user info
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        updatedUser,
        "Cover image updated successfully"
      )
    );
});

export {
  registerUser,
  LoginUser,
  LoggedOutUser,
  refreshAccessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateAccountDetails,
  updateUserAvatar,
  updateUserCoverImage,
};
