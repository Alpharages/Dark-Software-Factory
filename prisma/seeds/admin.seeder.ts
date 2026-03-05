import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

export async function seedAdminUser(prisma: PrismaClient): Promise<{ id: string; email: string }> {
    console.log('🌱 Seeding admin user...');

    const email = 'admin@darksoftwarefactory.com';
    const password = process.env.ADMIN_PASSWORD || 'Admin123!';

    // Check if admin exists
    const existingAdmin = await prisma.user.findUnique({
        where: { email },
    });

    if (existingAdmin) {
        console.log('ℹ️ Admin user already exists.');
        return existingAdmin;
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create admin user
    // ID is required as per schema (no default uuid)
    const admin = await prisma.user.create({
        data: {
            id: randomUUID(),
            email,
            full_name: 'System Administrator',
            password_hash: hashedPassword,
            role: 'ADMIN',
            is_active: true,
            last_login_at: null,
        },
    });

    console.log(`✅ Created admin user: ${admin.email}`);
    return admin;
}
