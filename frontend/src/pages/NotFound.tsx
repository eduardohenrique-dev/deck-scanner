import { D20 } from "../components/icons";
import { Button, EmptyState } from "../components/ui";
import { navigate } from "../lib/router";

export default function NotFound() {
  return (
    <EmptyState art={<D20 size={56} />} title="Rolou um 1 natural" action={<Button variant="brass" onClick={() => navigate("/")}>Voltar para a taverna</Button>}>
      Essa página não existe (ou foi apagada). Nada de errado com as suas cartas.
    </EmptyState>
  );
}
