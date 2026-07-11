const service=require('../services/catalog/catalog-service');
async function categories(req,res,next){try{res.json({success:true,data:await service.listCategories()});}catch(e){next(e);}}
module.exports={categories};
