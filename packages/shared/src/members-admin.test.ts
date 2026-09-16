import { describe, expect, it } from "vitest";
import {
  describeAlbionCheck,
  escapeLike,
  MEMBER_PAGE_SIZE,
  MEMBER_PAGE_SIZE_MAX,
  MEMBER_SEARCH_MAX,
  memberPageCount,
  normalizeMemberSearch,
  parseMemberFilter,
  parseMemberPagination,
} from "./members-admin.js";

describe("filtro da lista de membros (TASK-043, AC#4)", () => {
  it("aceita os filtros conhecidos", () => {
    expect(parseMemberFilter("todos")).toBe("todos");
    expect(parseMemberFilter("nao_encontrados")).toBe("nao_encontrados");
    expect(parseMemberFilter("sem_nick")).toBe("sem_nick");
  });

  it("valor desconhecido ou ausente cai em todos", () => {
    for (const value of ["", "banidos", null, undefined, 7, {}]) expect(parseMemberFilter(value)).toBe("todos");
  });
});

describe("busca por nick ou usuário do Discord (AC#4)", () => {
  it("tira espaço, baixa a caixa e limita o tamanho", () => {
    expect(normalizeMemberSearch("  Erijj  ")).toBe("erijj");
    expect(normalizeMemberSearch("x".repeat(MEMBER_SEARCH_MAX + 10))).toHaveLength(MEMBER_SEARCH_MAX);
  });

  it("vazio, só espaço ou não-string viram null (sem filtro)", () => {
    for (const value of ["", "   ", null, undefined, 3]) expect(normalizeMemberSearch(value)).toBeNull();
  });

  it("escapa curingas do LIKE para a busca ser literal", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("c:\\albion")).toBe("c:\\\\albion");
    expect(escapeLike("erijj")).toBe("erijj");
  });
});

describe("paginação", () => {
  it("default é a primeira página com o tamanho padrão", () => {
    expect(parseMemberPagination(undefined, undefined)).toEqual({ page: 1, pageSize: MEMBER_PAGE_SIZE, offset: 0 });
  });

  it("calcula o offset a partir da página", () => {
    expect(parseMemberPagination("3", "10")).toEqual({ page: 3, pageSize: 10, offset: 20 });
  });

  it("limita o tamanho e nunca deixa página menor que 1", () => {
    expect(parseMemberPagination("0", "500")).toEqual({ page: 1, pageSize: MEMBER_PAGE_SIZE_MAX, offset: 0 });
    expect(parseMemberPagination("-4", "0")).toEqual({ page: 1, pageSize: 1, offset: 0 });
  });

  it("lixo na URL vira o default", () => {
    expect(parseMemberPagination("abc", "xyz")).toEqual({ page: 1, pageSize: MEMBER_PAGE_SIZE, offset: 0 });
    expect(parseMemberPagination(2.9, 10.7)).toEqual({ page: 2, pageSize: 10, offset: 10 });
  });

  it("conta páginas com mínimo de 1", () => {
    expect(memberPageCount(0, 25)).toBe(1);
    expect(memberPageCount(25, 25)).toBe(1);
    expect(memberPageCount(26, 25)).toBe(2);
  });
});

describe("rótulo do status do Albion (AC#2)", () => {
  it("encontrado mostra a guilda quando existe", () => {
    expect(describeAlbionCheck({ status: "found", guildName: "Genei Rin", checkedAt: "2026-09-16T00:00:00Z" })).toEqual({
      kind: "found",
      label: "Encontrado",
      detail: "Guilda Genei Rin",
    });
    expect(describeAlbionCheck({ status: "found", guildName: null, checkedAt: null }).detail).toBe("Sem guilda");
  });

  it("distingue não encontrado, indisponível e nunca conferido", () => {
    expect(describeAlbionCheck({ status: "not_found", guildName: null, checkedAt: null }).kind).toBe("not_found");
    expect(describeAlbionCheck({ status: "unavailable", guildName: null, checkedAt: null }).label).toBe("Consulta indisponível");
    expect(describeAlbionCheck({ status: null, guildName: null, checkedAt: null })).toEqual({ kind: "unchecked", label: "Não conferido", detail: null });
    expect(describeAlbionCheck({ status: "disabled", guildName: null, checkedAt: null }).kind).toBe("unchecked");
  });
});
