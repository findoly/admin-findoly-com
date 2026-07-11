const LeadDistribution = require('../../models/LeadDistribution');
const { getPagination, pageResult } = require('../../utils/pagination');
async function list(filters={}){const{page,limit,skip}=getPagination(filters);const q={};if(filters.providerId)q.providerId=filters.providerId;if(filters.requirementId)q.requirementId=filters.requirementId;if(filters.status)q.status=filters.status;if(filters.categorySlug)q.categorySlug=filters.categorySlug;const[data,total]=await Promise.all([LeadDistribution.find(q).sort({distributedAt:-1}).skip(skip).limit(limit).lean(),LeadDistribution.countDocuments(q)]);return pageResult(data,total,page,limit);}
module.exports={list};
