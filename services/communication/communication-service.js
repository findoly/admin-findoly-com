const Communication = require('../../models/Communication');
const { getPagination, pageResult } = require('../../utils/pagination');
function idQuery(id){return{$or:[{communicationId:id},{id},{_id:id}]};}
async function list(filters={}){const{page,limit,skip}=getPagination(filters);const q={};if(filters.channel)q.channel=filters.channel;if(filters.enquiryId)q.enquiryId=filters.enquiryId;if(filters.q){const r=new RegExp(String(filters.q),'i');q.$or=[{recipientName:r},{recipientContact:r},{message:r},{enquiryId:r}];}const[data,total]=await Promise.all([Communication.find(q).sort({createdAt:-1}).skip(skip).limit(limit).lean(),Communication.countDocuments(q)]);return pageResult(data,total,page,limit);}
async function get(id){const doc=await Communication.findOne(idQuery(id)).lean();if(!doc)throw Object.assign(new Error('Communication not found'),{status:404});return doc;}
async function create(input){return Communication.create({enquiryId:input.enquiryId||'',providerId:input.providerId||'',recipientName:input.recipientName||'',recipientContact:input.recipientContact||'',channel:input.channel||'call',direction:input.direction||'outbound',message:input.message||'',status:input.status||'logged'});}
async function update(id,input){const result=await Communication.updateOne(idQuery(id),{$set:{...input,updatedAt:new Date()}});if(!result.matchedCount)throw Object.assign(new Error('Communication not found'),{status:404});return get(id);}
module.exports={list,get,create,update};
