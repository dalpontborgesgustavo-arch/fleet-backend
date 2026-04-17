const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@jr.com';
  const plainPassword = '123456';
  const password = await bcrypt.hash(plainPassword, 10);

  const existing = await prisma.user.findUnique({
    where: { email },
  });

  if (existing) {
    console.log('Usuário já existe:', existing.email);
    return;
  }

  const user = await prisma.user.create({
    data: {
      name: 'Admin',
      email,
      password,
      role: 'admin',
    },
  });

  console.log('Admin criado com sucesso:');
  console.dir(user, { depth: null });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
