const service=require('../services/enquiry/enquiry-service');
async function list(req,res,next){try{const result=await service.list(req.query);res.json({success:true,...result});}catch(e){next(e);}}
async function get(req,res,next){try{res.json({success:true,data:await service.get(req.params.enquiryId)});}catch(e){next(e);}}
async function create(req,res,next){try{res.status(201).json({success:true,data:await service.create(req.body,req.admin?.email||'api')});}catch(e){next(e);}}
async function createPublic(req,res,next){try{res.status(201).json({success:true,data:await service.create(req.body,'public-api')});}catch(e){next(e);}}
async function update(req,res,next){try{res.json({success:true,data:await service.update(req.params.enquiryId,req.body,req.admin?.email||'admin')});}catch(e){next(e);}}
async function note(req,res,next){try{res.json({success:true,data:await service.addNote(req.params.enquiryId,req.body.note,req.admin?.email||'admin')});}catch(e){next(e);}}
async function distribute(req,res,next){try{const lead=await service.get(req.params.enquiryId);res.json({success:true,data:await service.distribute(lead,req.admin?.email||'admin')});}catch(e){next(e);}}
module.exports={list,get,create,createPublic,update,note,distribute};
