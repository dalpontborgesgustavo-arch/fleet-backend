const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const dados = await prisma.checklist.findMany({
    orderBy: { id: 'desc' },
    take: 10
  });

  console.dir(dados, { depth: null });
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
