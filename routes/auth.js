const router=require('express').Router();const controller=require('../controllers/authController');const{apiAuth}=require('../middleware/auth');
router.post('/login',controller.login);router.get('/me',apiAuth,controller.me);router.post('/logout',apiAuth,controller.logout);module.exports=router;
