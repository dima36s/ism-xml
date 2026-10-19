"""Проверка XML-документов ИСМ в папке data/ перед публикацией.

Для каждого документа ИСМ (<ismDocument>):
  1. валидация по data/ism-regulation-v1.xsd (включая контроль ссылок xs:key/xs:keyref);
  2. цитата <quote> каждого атомарного требования есть в тексте его пункта;
  3. XSLT-представление data/ism-regulation-view.xsl отрабатывает без ошибок;
  4. в документе нет атрибутов person (репозиторий публичный, ФИО не публикуются).

Запуск: python tools/validate.py [папка]   (по умолчанию data)
Нужен пакет lxml: pip install lxml
"""
import sys
from pathlib import Path

from lxml import etree

NS = {"i": "urn:protech:ism:regulation:1.0"}


def norm(s):
    return " ".join((s or "").split())


def check(xml_path, schema, xslt):
    errors = []
    doc = etree.parse(str(xml_path))
    root = doc.getroot()
    if etree.QName(root).localname != "ismDocument":
        return None  # не документ ИСМ
    if etree.QName(root).namespace != NS["i"]:
        return [f"у <ismDocument> нет пространства имён {NS['i']}"]

    if not schema.validate(doc):
        errors += [f"XSD, строка {e.line}: {e.message}" for e in schema.error_log]

    reqs = root.findall(".//i:requirement", NS)
    for r in reqs:
        q = r.find("i:quote", NS)
        if q is None:
            continue
        t = r.getparent().find("i:text", NS)
        clause_text = norm(" ".join(t.itertext())) if t is not None else ""
        if norm(q.text) not in clause_text:
            errors.append(f"цитата требования {r.get('id')} не найдена в тексте пункта")

    persons = root.xpath("//@person")
    if persons:
        errors.append(f"в публичном документе есть ФИО (атрибут person): {len(persons)} шт.")

    try:
        xslt(doc)
    except etree.XSLTError as e:
        errors.append(f"XSLT: {e}")

    print(f"{xml_path.name}: требований {len(reqs)}, ошибок {len(errors)}")
    return errors


def main():
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else "data")
    schema = etree.XMLSchema(etree.parse(str(folder / "ism-regulation-v1.xsd")))
    xslt = etree.XSLT(etree.parse(str(folder / "ism-regulation-view.xsl")))
    failed = 0
    checked = 0
    for xml_path in sorted(folder.glob("*.xml")):
        res = check(xml_path, schema, xslt)
        if res is None:
            continue
        checked += 1
        for e in res:
            print("  -", e)
        failed += bool(res)
    if not checked:
        print("В папке нет документов ИСМ")
        return 1
    print("Готово." if not failed else f"Документов с ошибками: {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
