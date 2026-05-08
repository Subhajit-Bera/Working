import { Router } from 'express';
import { OrderController } from '../controllers/order.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const orderController = new OrderController();

router.use(authenticate);

router.post('/', orderController.createOrder.bind(orderController));
router.get('/', orderController.getUserOrders.bind(orderController));

export default router;
