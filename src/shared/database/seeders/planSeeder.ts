import logger from '../../utils/logger';
import { Plan } from '../models/plans.model';

export async function seedBasicPlan(): Promise<void> {
  try {
    const existingPlan = await Plan.findOne({ name: 'Yulduz bashorati' });

    if (!existingPlan) {
      await Plan.create({
        name: 'Yulduz bashorati',
        selectedName: 'yulduz',
        price: 5555,
        duration: 30,
      });

      logger.info('Plans seeded successfully');
    }

    logger.info('Plans already exists');
  } catch (error) {
    logger.error('Error seeding basic plan:', error);
    throw error;
  }
}
