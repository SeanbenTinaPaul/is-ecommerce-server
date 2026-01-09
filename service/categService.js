const prisma = require("../config/prisma");

exports.createCategory = async (req , res) => {
    const {email} = req.body;
    try{
        const { name } = req.body;
        const category = await prisma.category.create({
            data:{
                name:name,
                createdBy: email
            }
        })
        res.send(category);
    }catch(err){
        console.log(err);
        res.status(500).json({message: "Server Error"});
    } 
}

exports.listCategory = async (req , res) => {
    try{
        //findMany === select * from category
        const category = await prisma.category.findMany()
        res.send(category);
    }catch(err){
        console.log(err);
        res.status(500).json({message: "Server Error"});
    } 
}

exports.removeCategory = async (req , res) => {
    try{
        const { id } = req.params;
        const category = await prisma.category.delete({
            where:{
                id: parseInt(id)
            }
        })
        res.send(category);
    }catch(err){
        console.log(err);
        res.status(500).json({message: "Server Error"});
    } 
}

exports.updateCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        
        const category = await prisma.category.update({
            where: { id: parseInt(id) },
            data: { name: name.trim() }
        });
        
        res.json({ success: true, data: category });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};
