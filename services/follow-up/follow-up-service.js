const FollowUp = require('../../models/FollowUp');
const { getPagination, pageResult } = require('../../utils/pagination');
function idQuery(id){ return { $or: [{ followUpId:id }, { id }, { _id:id }] }; }
async function list(filters={}) { const {page,limit,skip}=getPagination(filters); const q={}; if(filters.status)q.status=filters.status; if(filters.enquiryId)q.enquiryId=filters.enquiryId; if(filters.q){const r=new RegExp(String(filters.q),'i');q.$or=[{title:r},{customerName:r},{notes:r},{enquiryId:r}];} const [data,total]=await Promise.all([FollowUp.find(q).sort({dueAt:1,createdAt:-1}).skip(skip).limit(limit).lean(),FollowUp.countDocuments(q)]); return pageResult(data,total,page,limit); }
async function get(id){const doc=await FollowUp.findOne(idQuery(id)).lean();if(!doc)throw Object.assign(new Error('Follow-up not found'),{status:404});return doc;}
async function create(input){return FollowUp.create({enquiryId:input.enquiryId||'',customerName:input.customerName||'',title:input.title,dueAt:input.dueAt||'',owner:input.owner||'admin',channel:input.channel||'call',status:input.status||'open',notes:input.notes||''});}
async function update(id,input){const result=await FollowUp.updateOne(idQuery(id),{$set:{...input,updatedAt:new Date()}});if(!result.matchedCount)throw Object.assign(new Error('Follow-up not found'),{status:404});return get(id);}
module.exports={list,get,create,update};
