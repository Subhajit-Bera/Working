import { Request, Response, NextFunction } from 'express';
import { OrderService } from '../services/order.service';

const orderService = new OrderService();

export class OrderController {
  async createOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const orderData = req.body;
      const order = await orderService.createOrder(userId, orderData);
      
      res.status(201).json({
        success: true,
        data: order,
        message: 'Order created successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async getUserOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { status, page = 1, limit = 10 } = req.query;
      
      const orders = await orderService.getUserOrders(userId, {
        status: status as string,
        page: Number(page),
        limit: Number(limit),
      });
      
      res.json({
        success: true,
        data: orders,
      });
    } catch (error) {
      next(error);
    }
  }
}
