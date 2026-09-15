import { defineConfig } from "@neon/config/v1";

// Deck Scanner na Neon (São Paulo): Postgres + login (Neon Auth).
// Os arquivos (fotos e recortes) ficam no Cloudflare R2: o storage da Neon é beta e não existe nesta região.
export default defineConfig({
  auth: true,
  branch: (branch) => {
    if (branch.isDefault) {
      return {
        postgres: {
          computeSettings: {
            // plano gratuito = 100 CU-h por mês; com o teto em 0,25 CU são ~400 horas acordado
            autoscalingLimitMinCu: 0.25,
            autoscalingLimitMaxCu: 0.25,
          },
        },
      };
    }
    if (!branch.exists) {
      // branches de teste somem sozinhas
      return { ttl: "7d" };
    }
    return {};
  },
});
