const prisma = require("../config/prisma");
const { update } = require("./productService");
// This is your test secret API key.
const stripe = require("stripe")(
   "sk_test_51QlpOAGb4ZSqFhpE6FhBvXqzDC2qX4JmY7Eq1m95ByjMqhQ9KeNcKr56CXhua6v4sRijTDVNSBaqjtJPX2lGKzmP005cQUf1Pp"
);
//save in cloud ONLY, NOT DB → https://dashboard.stripe.com/test/payments
exports.createPayment = async (req, res) => {
   try {
      //req.user.id from authCheck
      const cart = await prisma.cart.findFirst({
         where: {
            orderedById: Number(req.user.id)
         }
      });
      console.log("cart for payment->", cart);

      // Check if cart exists
      if (!cart) {
         return res.status(400).json({
            success: false,
            message: "No cart found. Please add items to cart before payment."
         });
      }

      const convertToTHBforCloud = parseInt((cart.cartTotal * 100));
      // Create a PaymentIntent with the order amount and currency
      //ต้องเรียก api นี้จึงจะ display <Elements> ใน PaymentMethod.jsx
      const paymentIntent = await stripe.paymentIntents.create({
         //stripe เอาเงินไปแปลงหน่วยเป็น สตางค์ อัตโนมัติ → ต้องเอาไป X 100 ดักทางมันก่อน
         amount: convertToTHBforCloud,
         //  amount: calculateOrderAmount(items),
         currency: "thb",
         //  confirm: true,
         //  payment_method_types: ['card', 'promptpay'],
         // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
         automatic_payment_methods: {
            enabled: true
         }
      });
      // console.log('paymentIntent->',paymentIntent)
      res.status(200).json({
         success: true,
         message: "Create Payment Success.",
         clientSecret: paymentIntent.client_secret,
         paymentIntent: paymentIntent
         //  data: users
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({
         success: false,
         message: "Error!!! Cannot Create Payment."
      });
   }
};

//pending...
/* Need req.body:
0. user id (token)
1. product id
2. quantity
3. order id

Need backend:
0. add col isRefunded Boolean @default(false) in table ProductOnOrder | col refundAmount Float @default(0) in table Order
1. productOnOrder.updateMany({where:{orderId:order.id}, data:{isRefunded:true}})
2. product.updateMany({where:{id:{in:productIds}}, data:{quantity:{increment:quantity}}})
*/
exports.reqRefund = async (req, res) => {
   // console.log("reqRefund-->", req.body);
   const { orderId } = req.body;
   /*
   new Date().getTime() - new Date(order.createdAt).getTime() <= 7 * 24 * 60 * 60 * 1000
   */
   try {
      // Create a Date object for 3 days ago in UTC
      const now = new Date();
      const threeDaysInMs = 3 * 24 * 60 * 60 * 1000;
      const expiredDate = new Date(now.getTime() - threeDaysInMs);
      // Query will automatically handle timezone conversion
      const orderData = await prisma.order.findFirst({
         where: {
            id: parseInt(orderId),
            orderStatus: "Completed",
            createdAt: {
               gte: expiredDate // Prisma will handle timezone conversion
            }
         },
         include: {
            products: {
               include: {
                  product: { select: { sold: true, quantity: true } }
               }
            }
         }
      });
      console.log("orderData->", orderData);
      if (!orderData) {
         return res.status(400).json({
            success: false,
            message: "Order expired or not found"
         });
      }

      const amountInBahtforCloud = (orderData.amount*100) - (orderData.amount*100*0.05)
      const refund = await stripe.refunds.create({
         payment_intent: orderData.paymentId, // → change to Order.paymentId
         // amount:(Order.amount*100) - (Order.amount*100*0.05) → stripe fee ~5%
         amount:parseInt(amountInBahtforCloud)  //for full refund, rm this line
      });
      if(!refund){
         return res.status(400).json({
            success: false,
            message: "Error!!! Cannot Refund."
         });
      }
      //$transaction - SAFE for database operations If order update fails, product update is rolled back
      //Using Promise.all - UNSAFE If order update fails, product might still update
      await prisma.$transaction(async (prisma) => {
         //1. update Order
         await prisma.order.update({
            where: { id: orderData.id },
            data: {
               orderStatus: "Refunded",
               //have to parseInt() since 'stripe.refunds' needs integer refund amount
               refundAmount: parseInt(amountInBahtforCloud/100)
            }
         });
         //2. update ProductOnOrder
         await prisma.productOnOrder.updateMany({
            where: { orderId: orderData.id },
            data: { isRefunded: true }
         });
         //3. update Product
         for (const obj of orderData.products) {
            await prisma.product.updateMany({
               where: { id: obj.productId },
               data: { quantity: { increment: obj.count }, sold: { decrement: obj.count } }
            });
         }
      });
     
      res.status(200).json({
         success: true,
         message: "Refund Success.",
         refundId: refund.id,
         refundStatus: refund.status,
         refundAmount: refund.amount / 100, // Convert back to THB
         confirmEmail: refund.next_action?.display_details?.email_sent?.email_sent_to || null,
         expireAT: refund.next_action?.display_details?.expires_at || null,

         // data: refund
      });
   } catch (err) {
      console.log('err in refund->',err);
      res.status(500).json({
         success: false,
         message: err.message
      });
   }
};

exports.cancelPayment = async (req, res) => {
   //const paymentIntent = await stripe.paymentIntents.cancel('pi_32AkjQ5H4Bas2eAolX13');
   const { id } = req.body;
   // console.log("cancelPayment-->", req.body);
   try {
      if (!id) {
         return res.status(400).json({
            success: false,
            message: "Error!!! Cannot Cancel Payment. Payment ID not found."
         });
      }
      const cancelPayment = await stripe.paymentIntents.cancel(id);
      res.status(200).json({
         success: true,
         message: "Cancel Payment Success.",
         status: cancelPayment.status,
         cancelDate: cancelPayment.canceled_at
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({
         success: false,
         message: "Error!!! Cannot Cancel Payment."
      });
   }
};
