import 'dotenv/config';
import { prisma, closeDb } from '../lib/db/client.ts';
import { hashPassword } from '../lib/auth/password.ts';

async function main() {
  console.log('Seeding development database (esniffer_dev)...');

  // 1. Watermark singleton row
  await prisma.$executeRawUnsafe(`
    INSERT INTO "history_sequence_watermark" ("id", "current_sequence")
    VALUES (1, 0)
    ON CONFLICT ("id") DO NOTHING;
  `);

  // 2. Chambers
  const chamber1 = await prisma.chamber.upsert({
    where: { code: 'CH-01' },
    update: { name: 'Chamber 1 (Kolam A)' },
    create: {
      code: 'CH-01',
      name: 'Chamber 1 (Kolam A)',
      description: 'Chamber monitoring kolam pembesaran A',
      isActive: true,
    },
  });

  const chamber2 = await prisma.chamber.upsert({
    where: { code: 'CH-02' },
    update: { name: 'Chamber 2 (Kolam B)' },
    create: {
      code: 'CH-02',
      name: 'Chamber 2 (Kolam B)',
      description: 'Chamber monitoring kolam pembesaran B',
      isActive: true,
    },
  });

  console.log(`Chambers seeded: ${chamber1.code}, ${chamber2.code}`);

  // 3. Devices
  const device1 = await prisma.device.upsert({
    where: { mqttDeviceId: 'esp32-001' },
    update: { name: 'e-Sniffer Sensor Node 01' },
    create: {
      mqttDeviceId: 'esp32-001',
      name: 'e-Sniffer Sensor Node 01',
      isActive: true,
      firmwareVersion: '1.0.0',
    },
  });

  const device2 = await prisma.device.upsert({
    where: { mqttDeviceId: 'esp32-002' },
    update: { name: 'e-Sniffer Sensor Node 02' },
    create: {
      mqttDeviceId: 'esp32-002',
      name: 'e-Sniffer Sensor Node 02',
      isActive: true,
      firmwareVersion: '1.0.0',
    },
  });

  console.log(`Devices seeded: ${device1.mqttDeviceId}, ${device2.mqttDeviceId}`);

  // 4. Device Assignment: esp32-001 -> CH-01 (Only if device has no active assignment)
  const existingActiveAssignment = await prisma.deviceAssignment.findFirst({
    where: {
      deviceId: device1.id,
      activeUntil: null,
    },
  });

  if (!existingActiveAssignment) {
    const assignment = await prisma.deviceAssignment.create({
      data: {
        deviceId: device1.id,
        chamberId: chamber1.id,
        activeFrom: new Date('2026-09-01T00:00:00.000Z'),
        activeUntil: null,
      },
    });
    console.log(`Device assignment created: ${device1.mqttDeviceId} -> ${chamber1.code} (${assignment.id})`);
  } else {
    console.log(`Device assignment already exists: ${device1.mqttDeviceId} (active assignment ID: ${existingActiveAssignment.id})`);
  }

  // 5. Users (Development Admin & Viewer)
  const adminHash = await hashPassword('admin123');
  const viewerHash = await hashPassword('viewer123');

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@esniffer.local' },
    update: { role: 'ADMIN', isActive: true },
    create: {
      email: 'admin@esniffer.local',
      passwordHash: adminHash,
      role: 'ADMIN',
      isActive: true,
    },
  });

  const viewerUser = await prisma.user.upsert({
    where: { email: 'operator@esniffer.local' },
    update: { role: 'VIEWER', isActive: true },
    create: {
      email: 'operator@esniffer.local',
      passwordHash: viewerHash,
      role: 'VIEWER',
      isActive: true,
    },
  });

  console.log(`Users seeded: ${adminUser.email} (ADMIN), ${viewerUser.email} (VIEWER)`);
  console.log('Seed completed successfully.');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await closeDb();
  });
