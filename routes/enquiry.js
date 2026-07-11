const router=require('express').Router();const c=require('../controllers/enquiryController');
router.get('/',c.list);router.post('/',c.create);router.get('/:enquiryId',c.get);router.put('/:enquiryId',c.update);router.patch('/:enquiryId',c.update);router.post('/:enquiryId/note',c.note);router.post('/:enquiryId/distribute',c.distribute);module.exports=router;
