const router=require('express').Router();const c=require('../controllers/distributionController');router.get('/',c.list);module.exports=router;
