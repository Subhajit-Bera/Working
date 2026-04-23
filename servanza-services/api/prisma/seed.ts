import { PrismaClient } from '@prisma/client';
import { UserRole, AuthProvider } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create admin user
  const adminPasswordHash = await bcrypt.hash('Admin@123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@servicemarketplace.com' },
    update: {},
    create: {
      email: 'admin@servicemarketplace.com',
      name: 'Admin User',
      passwordHash: adminPasswordHash,
      role: UserRole.ADMIN,
      authProvider: AuthProvider.EMAIL,
      isActive: true,
      emailVerified: true,
    },
  });
  console.log('Admin user created:', admin.email);

  // Create test user
  const userPasswordHash = await bcrypt.hash('User@123', 10);
  const testUser = await prisma.user.upsert({
    where: { email: 'user@test.com' },
    update: {},
    create: {
      email: 'user@test.com',
      name: 'Test User',
      phone: '+919876543210',
      passwordHash: userPasswordHash,
      role: UserRole.USER,
      authProvider: AuthProvider.EMAIL,
      isActive: true,
      emailVerified: true,
      phoneVerified: true,
    },
  });
  console.log('Test user created:', testUser.email);

  // Create test buddy

  // Create categories
  const categories = [
    {
      name: 'Home Cleaning',
      slug: 'home-cleaning',
      description: 'Professional home cleaning services',
      icon: '🏠',
      isActive: true,
      sortOrder: 1,
    },
    {
      name: 'Plumbing',
      slug: 'plumbing',
      description: 'Expert plumbing services',
      icon: '🔧',
      isActive: true,
      sortOrder: 2,
    },
  ];

  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: category,
    });
  }
  console.log('✅ Categories created');

  // Create services
  const homeCleaningCategory = await prisma.category.findUnique({
    where: { slug: 'home-cleaning' },
  });

  if (homeCleaningCategory) {
    const services = [
      {
        categoryId: homeCleaningCategory.id,
        title: 'Deep House Cleaning',
        description: 'Comprehensive deep cleaning of your entire home',
        durationMins: 180,
        basePrice: 1500,
        currency: 'INR',
        isActive: true,
      },
    ];

    for (const service of services) {
      await prisma.service.create({
        data: service,
      });
    }
    console.log('✅ Services created');
  }

  // Create test address
  const addressLat = 28.6315;
  const addressLng = 77.2167;
  
  const newAddress = await prisma.address.create({
    data: {
      userId: testUser.id,
      label: 'Home',
      formattedAddress: 'Connaught Place, New Delhi, Delhi 110001, India',
      streetAddress: 'Connaught Place',
      city: 'New Delhi',
      state: 'Delhi',
      postalCode: '110001',
      country: 'IN',
      latitude: addressLat,
      longitude: addressLng,
      isDefault: true,
    },
  });

  const addressLocationGeo = `ST_SetSRID(ST_MakePoint(${addressLng}, ${addressLat}), 4326)::geography`;
  await prisma.$executeRawUnsafe(
    `UPDATE "addresses" SET "location" = ${addressLocationGeo} WHERE id = $1`,
    newAddress.id
  );
  console.log('✅ Test address created');

  // Create configuration
  const configs = [
    { key: 'MAX_BUDDY_RADIUS', value: 10 },
    { key: 'COOLDOWN_DAYS', value: 7 },
    { key: 'MIN_GAP_MINUTES', value: 30 },
  ];

  for (const config of configs) {
    await prisma.config.upsert({
      where: { key: config.key },
      update: { value: config.value as any },
      create: { key: config.key, value: config.value as any },
    });
  }
  console.log('✅ Configuration created');

  console.log('🎉 Seeding completed!');
  console.log('\n📝 Test Credentials:');
  console.log('Admin: admin@servicemarketplace.com / Admin@123');
  console.log('User: user@test.com / User@123');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });