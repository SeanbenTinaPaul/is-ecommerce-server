const express = require("express");
const router = express.Router();
//import service
const {
   createUserCart,
   getUserCart,
   clearCart,
   saveAddress,
   saveOrder,
   getOrder,
   addProdRating,
   favoriteProduct,
   updateUserProfile
} = require("../service/userService");

const { userVerify } = require("../middlewares/authVerify");

router.post("/user/cart", userVerify, createUserCart); //add cart
router.get("/user/cart", userVerify, getUserCart);

router.delete("/user/cart", userVerify, clearCart); //ไม่มี id เพราะจะใช้ id จาก token user คนนั้น

router.post("/user/address", userVerify, saveAddress);

router.post("/user/order", userVerify, saveOrder);
router.get("/user/order", userVerify, getOrder);
router.post('/user/rating', userVerify, addProdRating);

router.patch("/user/update-profile", userVerify, updateUserProfile);
router.post("/user/favorite",userVerify, favoriteProduct);

module.exports = router;
