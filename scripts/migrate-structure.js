require('dotenv').config();
const connectDatabase=require('../db/connection');
const Enquiry=require('../models/Enquiry');
const Provider=require('../models/Provider');
const LeadDistribution=require('../models/LeadDistribution');
const WalletTransaction=require('../models/WalletTransaction');
const PaymentOrder=require('../models/PaymentOrder');
const FollowUp=require('../models/FollowUp');
const Communication=require('../models/Communication');
const Invoice=require('../models/Invoice');
const enquiryService=require('../services/enquiry/enquiry-service');
const providerService=require('../services/provider/provider-service');
const {normalizeMobile}=require('../utils/mobile');

async function copyNamedId(Model,field){const docs=await Model.find({$or:[{[field]:{$exists:false}},{[field]:''}]}).select('_id id').lean();for(const doc of docs){const value=String(doc.id||doc._id);await Model.collection.updateOne({_id:doc._id},{$set:{[field]:value,id:String(doc.id||value)}});}return docs.length;}
async function run(){await connectDatabase();const counts={};counts.enquiries=await copyNamedId(Enquiry,'enquiryId');counts.providers=await copyNamedId(Provider,'providerId');counts.distributions=await copyNamedId(LeadDistribution,'leadDistributionId');counts.wallet=await copyNamedId(WalletTransaction,'walletTransactionId');counts.payments=await copyNamedId(PaymentOrder,'paymentOrderId');counts.followUps=await copyNamedId(FollowUp,'followUpId');counts.communications=await copyNamedId(Communication,'communicationId');counts.invoices=await copyNamedId(Invoice,'invoiceId');
  const leads=await Enquiry.find();for(const lead of leads){const flat=enquiryService.normalizeInput({},lead.toObject());await Enquiry.collection.updateOne({_id:lead._id},{$set:{...flat,enquiryId:lead.enquiryId||lead.id||String(lead._id)}});}
  const providers=await Provider.find();for(const provider of providers){const providerId=provider.providerId||provider.id||String(provider._id);await Provider.collection.updateOne({_id:provider._id},{$set:{providerId,normalizedMobile:normalizeMobile(provider.normalizedMobile||provider.mobile)}});await providerService.syncApprovedLeads({...provider.toObject(),providerId});}
  console.log('Migration completed without changing existing _id or id values:',counts);process.exit(0);
}
run().catch(error=>{console.error(error);process.exit(1);});
