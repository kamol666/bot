import logger from "../../utils/logger";
import {Plan} from "../models/plans.model";

export async function seedBasicPlan(): Promise<void> {
    try {
        const existingPlan = await Plan.findOne({name: 'Futbol'});

        if (!existingPlan) {
            await Plan.create({
                name: 'Futbol',
                price: 7777,
                duration: 30
            });

            logger.info('Futbol plan seeded successfully');
        }
        const existingPlan2 = await Plan.findOne({name: 'Yakka kurash'});
        if (!existingPlan2) {
            await Plan.create({
                name: 'Yakka kurash',
                price: 7777,
                duration: 30
            });

            logger.info('Yakka kurash plan seeded successfully');
        }

        logger.info('Basic plan already exists');
    } catch (error) {
        logger.error('Error seeding basic plan:', error);
        throw error;
    }
}