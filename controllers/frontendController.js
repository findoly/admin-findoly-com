function render(view,title,extra=()=>({})){return(req,res)=>res.render(view,{title,currentPath:req.path,...extra(req)});}
const pages={
  login:render('auth/login','Admin login',req=>({returnTo:req.query.returnTo||'/dashboard'})),
  dashboard:render('dashboard/index','Dashboard'),
  enquiries:render('enquiry/index','Requirements'),
  enquiryCreate:render('enquiry/form','Create requirement',()=>({mode:'create',recordId:''})),
  enquiryEdit:render('enquiry/form','Edit requirement',req=>({mode:'edit',recordId:req.params.enquiryId})),
  enquiryShow:render('enquiry/show','Requirement details',req=>({recordId:req.params.enquiryId})),
  providers:render('provider/index','Providers'),
  providerCreate:render('provider/form','Create provider',()=>({mode:'create',recordId:''})),
  providerEdit:render('provider/form','Edit provider',req=>({mode:'edit',recordId:req.params.providerId})),
  providerShow:render('provider/show','Provider details',req=>({recordId:req.params.providerId})),
  followUps:render('follow-up/index','Follow-ups'),
  followUpCreate:render('follow-up/form','Create follow-up',req=>({mode:'create',recordId:'',enquiryId:req.query.enquiryId||''})),
  followUpEdit:render('follow-up/form','Edit follow-up',req=>({mode:'edit',recordId:req.params.followUpId,enquiryId:''})),
  communications:render('communication/index','Communications'),
  communicationCreate:render('communication/form','Log communication',req=>({mode:'create',recordId:'',enquiryId:req.query.enquiryId||''})),
  communicationEdit:render('communication/form','Edit communication',req=>({mode:'edit',recordId:req.params.communicationId,enquiryId:''})),
  invoices:render('invoice/index','Invoices'),
  invoiceCreate:render('invoice/form','Create invoice',req=>({mode:'create',recordId:'',enquiryId:req.query.enquiryId||''})),
  invoiceEdit:render('invoice/form','Edit invoice',req=>({mode:'edit',recordId:req.params.invoiceId,enquiryId:''})),
  distributions:render('distribution/index','Lead distribution'),
  reports:render('report/index','Reports')
};
module.exports=pages;
