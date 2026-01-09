const prisma = require("../config/prisma");

//Feature/Button: "View All Users", "User Management", "Admin: View Users"
exports.getAllUsers = async (req, res) => {
   try {
      const users = await prisma.user.findMany({
         select: {
            id: true,
            name: true,
            email: true,
            role: true,
            enabled: true,
            address: true,
            createdAt: true,
            updatedAt: true
         }
      });

      res.status(200).json({
         success: true,
         message: "Get to All User Success",
         data: users
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({
         success: false,
         message: "Error!!! Cannot get all user."
      });
   }
};

//Feature/Button: "Enable/Disable User", "Change User Status", "Admin: Update User Status"
exports.changeUserStatus = async (req, res) => {
   try {
      const { userIdArr, userEnabled, userRole } = req.body;
      const booleanEnabled = JSON.parse(userEnabled); //make "true" → true
      const { email, id } = req.user;

      //change himself not allowed
      if (userIdArr.includes(id)) {
         return res.status(400).json({
            success: false,
            message: "You cannot change your own status."
         });
      }

      const user = await prisma.user.updateMany({
         where: { id: { in: userIdArr.map((id) => parseInt(id)) } },
         data: { enabled: booleanEnabled, role: userRole, updatedBy: email }
      });

      res.status(200).json({
         success: true,
         message: `Updated ID: ${userIdArr.join(", ")} status to "${userRole}". Enabled: ${
            booleanEnabled ? '"Yes"' : '"No"'
         }.`
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({
         success: false,
         message: "Failed to update user status"
      });
   }
};

exports.changeOrderStatus = async (req, res) => {
   try {
      const { orderIdArr, orderStatus } = req.body;
      const { email } = req.user;
      const countOrderUpdate = await prisma.order.updateMany({
         where: { id: { in: orderIdArr } },
         data: { orderStatus: orderStatus, updatedBy: email }
      });

      res.status(200).json({
         success: true,
         message: `${countOrderUpdate.count} order(s) successfully updated to "${orderStatus}" `,
         data: countOrderUpdate
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({ message: "Server Error" });
   }
};

exports.getOrderAdmin = async (req, res) => {
   try {
      const orders = await prisma.order.findMany({
         include: {
            products: {
               include: { product: true }
            },
            orderedBy: {
               select: {
                  id: true,
                  name: true,
                  email: true,
                  address: true
               }
            }
         }
      });
      res.status(200).json({ success: true, message: "Get Order Admin Success", data: orders });
   } catch (err) {
      console.log(err);
      res.status(500).json({ message: "Server Error" });
   }
};

// Paginated orders for Load More feature
exports.getOrderAdminPaginated = async (req, res) => {
   try {
      const skip = parseInt(req.query.skip) || 0;
      const take = parseInt(req.query.take) || 20;

      const [orders, total] = await Promise.all([
         prisma.order.findMany({
            skip,
            take,
            orderBy: [
               { createdAt: "desc" },
               { id: "desc" }
            ],
            include: {
               products: {
                  include: { product: true }
               },
               orderedBy: {
                  select: {
                     id: true,
                     name: true,
                     email: true,
                     address: true
                  }
               }
            }
         }),
         prisma.order.count()
      ]);

      res.status(200).json({
         success: true,
         orders,
         hasMore: skip + take < total,
         total
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({ message: "Server Error" });
   }
};
