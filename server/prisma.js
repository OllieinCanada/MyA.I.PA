const { PrismaClient } = require("@prisma/client");

let prisma;

if (global.__myAiPaPrisma) {
  prisma = global.__myAiPaPrisma;
} else {
  prisma = new PrismaClient();
  global.__myAiPaPrisma = prisma;
}

module.exports = { prisma };
