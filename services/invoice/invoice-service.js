const Invoice = require('../../models/Invoice');
const { createId } = require('../../utils/id');
const { getPagination, pageResult } = require('../../utils/pagination');
function idQuery(id){return{$or:[{invoiceId:id},{id},{_id:id}]};}
function calculate(input={}){const items=Array.isArray(input.items)?input.items:[];const normalized=items.map(item=>({description:String(item.description||''),qty:Number(item.qty||1),rate:Number(item.rate||0)}));const subtotal=normalized.reduce((sum,item)=>sum+item.qty*item.rate,0);const discount=Number(input.discount||0);const tax=Number(input.tax||0);return{items:normalized,subtotal,discount,tax,total:Math.max(0,subtotal-discount+tax)};}
async function list(filters={}){const{page,limit,skip}=getPagination(filters);const q={};if(filters.status)q.status=filters.status;if(filters.q){const r=new RegExp(String(filters.q),'i');q.$or=[{invoiceNo:r},{customerName:r},{providerName:r},{enquiryId:r}];}const[data,total]=await Promise.all([Invoice.find(q).sort({createdAt:-1}).skip(skip).limit(limit).lean(),Invoice.countDocuments(q)]);return pageResult(data,total,page,limit);}
async function get(id){const doc=await Invoice.findOne(idQuery(id)).lean();if(!doc)throw Object.assign(new Error('Invoice not found'),{status:404});return doc;}
async function create(input){const amount=calculate(input);return Invoice.create({...input,...amount,invoiceNo:input.invoiceNo||`INV-${Date.now()}`});}
async function update(id,input){const current=await get(id);const amount=calculate({...current,...input});const result=await Invoice.updateOne(idQuery(id),{$set:{...input,...amount,updatedAt:new Date()}});if(!result.matchedCount)throw Object.assign(new Error('Invoice not found'),{status:404});return get(id);}
module.exports={calculate,list,get,create,update};
