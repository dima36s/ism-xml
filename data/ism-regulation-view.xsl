<?xml version="1.0" encoding="UTF-8"?>
<!--
  ism-regulation-view.xsl  v1.3
  Human View для документов ИСМ по схеме urn:protech:ism:regulation:1.0 (ism-regulation-v1.xsd 1.2).
  v1.3: поля корпоративного реестра — наименование, владелец, критичность C1–C4, критерий приёмки, карточка реестра.

  Страница повторяет структуру исходного документа (Document Layer: пункты с дословным текстом,
  таблицы, рисунки), а под каждым пунктом в свёрнутом блоке показывает его атомарные требования
  (Knowledge Layer). После текста документа — реестры ролей и объектов, семантические связи
  и замечания к исходному документу.

  Контроль целостности на странице: неразрешённые ссылки и цитаты <quote>, которых нет в тексте пункта.
  XSLT 1.0 без расширений: xsltproc, .NET XslCompiledTransform, Saxon, Firefox.
-->
<xsl:stylesheet version="1.0"
 xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
 xmlns:ism="urn:protech:ism:regulation:1.0"
 exclude-result-prefixes="ism">

<!-- doctype-system="about:legacy-compat" = стандартный способ XSLT 1.0 выдать HTML5 doctype -->
<xsl:output method="html" encoding="UTF-8" indent="yes" doctype-system="about:legacy-compat"/>

<xsl:key name="byId" match="*[@id]" use="@id"/>
<xsl:key name="notesByTarget" match="ism:editorialNotes/ism:note" use="@target"/>

<xsl:variable name="doc" select="/ism:ismDocument"/>
<xsl:variable name="reqs" select="//ism:requirement"/>

<xsl:variable name="unresolved"
  select="//ism:requirement/ism:subject/@ref[not(key('byId', .))]
        | //ism:requirement/ism:object/@ref[not(key('byId', .))]
        | //ism:requirement/ism:counterpart/@ref[not(key('byId', .))]
        | //ism:requirement/ism:externalReference/@ref[not(key('byId', .))]
        | //ism:scope/ism:audience/@ref[not(key('byId', .))]
        | //ism:link/@from[not(key('byId', .))]
        | //ism:link/@to[not(key('byId', .))]"/>

<xsl:variable name="badQuotes"
  select="$reqs[ism:quote][not(contains(normalize-space(../ism:text), normalize-space(ism:quote)))]"/>

<!-- ============================================================ -->
<xsl:template match="/">
<html lang="ru">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title><xsl:value-of select="$doc/@id"/> — <xsl:value-of select="$doc/ism:metadata/ism:title"/></title>
<style>
 :root{--ink:#222;--muted:#5d6a72;--accent:#164c70;--accent2:#2b7a9b;--line:#c9d8e0;--soft:#f4f8fa;--soft2:#eaf3f7;--warn-bg:#fff4e5;--warn-line:#efc28a;--warn-ink:#8a3b00;--ok:#2c6e3f}
 *{box-sizing:border-box}
 body{font-family:Arial,Helvetica,sans-serif;max-width:1120px;margin:32px auto;color:var(--ink);line-height:1.5;padding:0 24px;background:#fff;font-size:15px}
 h1{font-size:25px;color:var(--accent);border-bottom:3px solid var(--accent2);padding-bottom:12px;margin-bottom:4px}
 .org{color:var(--muted);margin:0 0 18px}
 h2{font-size:20px;color:var(--accent);margin-top:36px;border-bottom:1px solid var(--line);padding-bottom:5px}
 h3{font-size:17px;color:#245c7a;margin-top:26px}
 a{color:#1d6a8f}
 code{font-family:Consolas,Menlo,monospace;font-size:12px;background:#eef2f4;padding:1px 4px;border-radius:3px}
 table{border-collapse:collapse}
 .meta{width:100%;margin:16px 0}
 .meta th,.meta td,.doc th,.doc td,.reg th,.reg td{border:1px solid #9eb4c1;padding:7px 9px;vertical-align:top;text-align:left}
 .meta th{background:var(--soft2);width:210px;font-weight:bold}
 .doc{width:100%;margin:10px 0 14px}
 .doc th,.reg th{background:var(--soft2)}
 .doc ul,.reg ul{margin:0;padding-left:18px}
 .reg{width:100%;margin:12px 0;font-size:14px}
 .badge{display:inline-block;padding:2px 7px;border-radius:4px;background:var(--soft2);margin:0 4px 3px 0;font-size:12px;white-space:nowrap}
 .b-shall{background:#dceee3}.b-should{background:#e8eefc}.b-may{background:#eef0f2}.b-shall-not{background:#fbe0dc}
 .b-implicit{background:#fff3d6}.b-verbatim{background:#e6f2ec}
 .b-C1{background:#a5342e;color:#fff;font-weight:bold}.b-C2{background:#faefd9;color:#8f5b0e;font-weight:bold}.b-C3{background:#e5ebf7;color:#3b5ba5;font-weight:bold}.b-C4{background:#eef0f2;color:#6e8288;font-weight:bold}
 .b-draft{background:#fdf0d5}
 .panel{border:1px solid var(--line);background:var(--soft);padding:10px 16px;margin:16px 0;border-radius:4px}
 .panel.warn{border-color:var(--warn-line);background:var(--warn-bg)}
 .panel.ok{border-color:#b9dcc4;background:#f4faf6}
 .panel ul{margin:6px 0;padding-left:20px}
 .stats{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
 .stat{border:1px solid var(--line);border-radius:4px;padding:6px 10px;background:#fff;font-size:13px}
 .stat b{font-size:17px;color:var(--accent);display:block}
 .toolbar{margin:14px 0}
 .toolbar button{font:inherit;font-size:14px;padding:6px 12px;border:1px solid var(--accent2);background:#fff;color:var(--accent);border-radius:4px;cursor:pointer}
 .toolbar button:hover{background:var(--soft2)}
 .toc{columns:2;column-gap:32px}
 .toc ul{margin:4px 0;padding-left:18px}.toc li{margin:2px 0;break-inside:avoid}
 .clause{display:grid;grid-template-columns:62px 1fr;gap:0 8px;margin:10px 0}
 .clause .clause{grid-template-columns:34px 1fr;margin:8px 0}
 .cl-num{font-weight:bold;color:#333;padding-top:1px}
 .cl-body{min-width:0}
 .cl-body > p:first-child,.cl-body > .text > p:first-child{margin-top:0}
 .text p{margin:0 0 8px}
 .text ul{margin:4px 0 8px;padding-left:22px}
 ul.dash{list-style:none;padding-left:18px}
 ul.dash > li{position:relative}
 ul.dash > li::before{content:"–";position:absolute;left:-14px}
 .text li{margin:3px 0}
 .text li p{margin:6px 0}
 figure,.fig{margin:8px 0}
 .fig img{max-width:100%;height:auto;max-height:260px;border:1px solid #e2e8ec;background:#fff;padding:4px;display:block}
 details.atoms{margin:6px 0 10px;border-left:4px solid var(--accent2);background:var(--soft);border-radius:0 4px 4px 0}
 details.atoms > summary{cursor:pointer;padding:5px 10px;font-size:13px;color:var(--accent);font-weight:bold;list-style-position:inside}
 .atom{padding:8px 12px;border-top:1px solid var(--line);background:#fff}
 .atom-head{font-size:12px;color:var(--muted);margin-bottom:3px}
 .atom-head code{font-size:11px}
 .atom-stmt{font-weight:600}
 .props{display:grid;grid-template-columns:130px 1fr;gap:2px 12px;margin:6px 0 0;font-size:13px;color:#333}
 .props dt{color:var(--muted)}
 .props dd{margin:0}
 details.check summary{cursor:pointer;color:var(--muted)}
 details.check code{display:block;white-space:pre-wrap;word-break:break-all;margin-top:4px;padding:6px}
 .warn{display:inline-block;color:var(--warn-ink);background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:4px;padding:0 6px;font-size:12px;margin-left:4px}
 .flag{display:inline-block;font-size:11px;color:var(--warn-ink);background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:3px;padding:0 5px;margin-left:6px;text-decoration:none;white-space:nowrap}
 .ok-text{color:var(--ok)}
 .muted{color:var(--muted);font-size:13px}
 .layer{margin-top:48px;padding-top:6px;border-top:3px double var(--line)}
 .layer > p.muted{margin-top:0}
 .note{border-left:4px solid var(--warn-line);background:var(--warn-bg);padding:8px 12px;margin:10px 0}
 .note .nhead{font-size:12px;color:var(--warn-ink);margin-bottom:3px}
 :target{outline:2px solid var(--accent2);outline-offset:2px}
 .footer{margin-top:44px;border-top:1px solid #aaa;padding-top:10px;color:#777;font-size:12px}
 @media (max-width:720px){
  body{padding:0 16px}
  .meta th{width:auto}
  .meta td,.meta th{overflow-wrap:anywhere}
  .toc{columns:1}
  .clause{grid-template-columns:44px 1fr}
  .props{grid-template-columns:1fr}
 }
 @media (max-width:880px){.doc,.reg{display:block;overflow-x:auto}}
 @media print{.toolbar,.toc{display:none}a{color:inherit;text-decoration:none}.clause,.note{break-inside:avoid}}
</style>
</head>
<body>

<h1><xsl:value-of select="$doc/ism:metadata/ism:title"/></h1>
<p class="org"><xsl:value-of select="$doc/ism:metadata/ism:organization"/></p>

<!-- ===== Сводная информация ===== -->
<table class="meta">
<tr><th>Идентификатор</th><td><xsl:value-of select="$doc/@id"/></td></tr>
<tr><th>Версия</th><td><xsl:value-of select="$doc/@version"/></td></tr>
<tr><th>Статус</th><td><span class="badge b-{$doc/@status}"><xsl:call-template name="status-label"><xsl:with-param name="code" select="$doc/@status"/></xsl:call-template></span></td></tr>
<tr><th>Тип документа</th><td><xsl:value-of select="$doc/ism:metadata/ism:documentType"/>
 <xsl:if test="$doc/ism:metadata/ism:documentType/@code"> (<xsl:value-of select="$doc/ism:metadata/ism:documentType/@code"/>)</xsl:if></td></tr>
<tr><th>Наименование процесса</th><td>
 <xsl:choose>
  <xsl:when test="$doc/ism:metadata/ism:processPath">
   <xsl:for-each select="$doc/ism:metadata/ism:processPath/ism:process">
    <div><xsl:value-of select="@id"/><xsl:text> </xsl:text><xsl:value-of select="."/></div>
   </xsl:for-each>
  </xsl:when>
  <xsl:otherwise><xsl:value-of select="$doc/ism:metadata/ism:processRef/@id"/><xsl:text> </xsl:text><xsl:value-of select="$doc/ism:metadata/ism:processRef"/></xsl:otherwise>
 </xsl:choose>
</td></tr>
<tr><th>Владелец процесса</th><td><xsl:apply-templates select="$doc/ism:metadata/ism:owner" mode="party"/></td></tr>
<xsl:if test="$doc/ism:metadata/ism:manager"><tr><th>Менеджер процесса</th><td><xsl:apply-templates select="$doc/ism:metadata/ism:manager" mode="party"/></td></tr></xsl:if>
<xsl:if test="$doc/ism:metadata/ism:developer"><tr><th>Разработчик</th><td><xsl:apply-templates select="$doc/ism:metadata/ism:developer" mode="party"/></td></tr></xsl:if>
<xsl:if test="$doc/ism:metadata/ism:methodologist"><tr><th>Методолог ИСМ</th><td><xsl:apply-templates select="$doc/ism:metadata/ism:methodologist" mode="party"/></td></tr></xsl:if>
<xsl:if test="$doc/ism:scope">
<tr><th>Область применения</th><td>
 <xsl:for-each select="$doc/ism:scope/ism:applicability/ism:condition">
  <div><xsl:value-of select="."/><xsl:if test="@clause"> — <xsl:call-template name="ref-label"><xsl:with-param name="ref" select="@clause"/></xsl:call-template></xsl:if></div>
 </xsl:for-each>
 <xsl:for-each select="$doc/ism:scope/ism:audience">
  <div>Руководствуются: <xsl:call-template name="ref-label"><xsl:with-param name="ref" select="@ref"/></xsl:call-template>
   <xsl:if test="@clause"> — <xsl:call-template name="ref-label"><xsl:with-param name="ref" select="@clause"/></xsl:call-template></xsl:if></div>
 </xsl:for-each>
</td></tr>
</xsl:if>
</table>

<!-- ===== Целостность ===== -->
<xsl:choose>
 <xsl:when test="count($unresolved) + count($badQuotes) &gt; 0">
  <div class="panel warn">
   <strong>Целостность: найдено проблем — <xsl:value-of select="count($unresolved) + count($badQuotes)"/></strong>
   <ul>
    <xsl:for-each select="$unresolved">
     <li>Ссылка <code><xsl:value-of select="."/></code> не определена в документе (<xsl:value-of select="local-name(..)"/>)</li>
    </xsl:for-each>
    <xsl:for-each select="$badQuotes">
     <li>Цитата требования <a href="#{@id}"><xsl:value-of select="@id"/></a> не найдена в тексте пункта</li>
    </xsl:for-each>
   </ul>
  </div>
 </xsl:when>
 <xsl:otherwise>
  <div class="panel ok"><strong class="ok-text">Целостность подтверждена:</strong>
   все ссылки разрешены, цитаты <xsl:value-of select="count($reqs[ism:quote])"/> атомарных требований найдены в тексте своих пунктов.</div>
 </xsl:otherwise>
</xsl:choose>

<div class="stats">
 <div class="stat"><b><xsl:value-of select="count($reqs)"/></b>атомарных требований</div>
 <div class="stat"><b><xsl:value-of select="count($reqs[@modality='shall'])"/> / <xsl:value-of select="count($reqs[@modality='should'])"/> / <xsl:value-of select="count($reqs[@modality='shall-not'])"/></b>обязательно / рекомендуется / запрещено</div>
 <div class="stat"><b><xsl:value-of select="count($reqs[@modalityBasis='implicit'])"/></b>с выведенной модальностью</div>
 <div class="stat"><b><xsl:value-of select="count($reqs[ism:verification/ism:check])"/></b>с машинной проверкой BPMN</div>
 <div class="stat"><b><xsl:value-of select="count($doc/ism:roles/ism:role)"/> / <xsl:value-of select="count($doc/ism:objects/ism:object)"/></b>ролей / объектов</div>
 <div class="stat"><b><xsl:value-of select="count($doc/ism:semanticLinks/ism:link)"/></b>семантических связей</div>
 <xsl:if test="$doc/ism:editorialNotes"><div class="stat"><b><a href="#notes"><xsl:value-of select="count($doc/ism:editorialNotes/ism:note)"/></a></b>замечаний к исходному документу</div></xsl:if>
</div>

<div class="toolbar"><button type="button" id="toggleAtoms">Развернуть атомарные требования</button></div>

<!-- ===== Оглавление ===== -->
<h2>Оглавление</h2>
<nav class="toc">
<ul>
 <xsl:if test="$doc/ism:changeHistory"><li><a href="#changes">Регистрация изменений</a></li></xsl:if>
 <xsl:for-each select="$doc/ism:body/ism:section">
  <li><a href="#{@id}"><xsl:call-template name="section-title"/></a>
   <xsl:if test="ism:section">
    <ul><xsl:for-each select="ism:section"><li><a href="#{@id}"><xsl:call-template name="section-title"/></a></li></xsl:for-each></ul>
   </xsl:if>
  </li>
 </xsl:for-each>
 <xsl:if test="$doc/ism:roles"><li><a href="#roles">Реестр ролей</a></li></xsl:if>
 <xsl:if test="$doc/ism:objects"><li><a href="#objects">Реестр объектов</a></li></xsl:if>
 <xsl:if test="$doc/ism:semanticLinks"><li><a href="#links">Семантические связи</a></li></xsl:if>
 <xsl:if test="$doc/ism:editorialNotes"><li><a href="#notes">Замечания к исходному документу</a></li></xsl:if>
</ul>
</nav>

<!-- ===== Регистрация изменений ===== -->
<xsl:if test="$doc/ism:changeHistory">
<h2 id="changes">Регистрация изменений</h2>
<table class="doc">
<tr><th>Версия</th><th>Дата введения</th><th>Основание</th><th>Описание изменения</th></tr>
<xsl:for-each select="$doc/ism:changeHistory/ism:change">
<tr>
 <td><xsl:value-of select="@version"/></td>
 <td><xsl:choose><xsl:when test="@date"><xsl:value-of select="@date"/></xsl:when><xsl:otherwise><span class="muted">не заполнена</span></xsl:otherwise></xsl:choose></td>
 <td><xsl:value-of select="ism:basis"/></td>
 <td><xsl:value-of select="ism:description"/></td>
</tr>
</xsl:for-each>
</table>
</xsl:if>

<!-- Пилотная модель 1.0: термины вне тела документа -->
<xsl:if test="$doc/ism:terms and not(//ism:termList)">
 <h2 id="terms">Термины, сокращения и определения</h2>
 <xsl:call-template name="terms-table"/>
</xsl:if>

<!-- ===== Текст документа ===== -->
<xsl:apply-templates select="$doc/ism:body/ism:section"/>

<!-- Пилотная модель 1.0: перечень ссылок вне тела документа -->
<xsl:if test="$doc/ism:references and not(//ism:referenceList)">
 <h2 id="references">Нормативные ссылки</h2>
 <xsl:call-template name="refs-table"/>
</xsl:if>

<!-- ===== Knowledge Layer ===== -->
<xsl:if test="$doc/ism:roles or $doc/ism:objects or $doc/ism:semanticLinks or $doc/ism:editorialNotes">
<div class="layer">

<xsl:if test="$doc/ism:roles">
<h2 id="roles">Реестр ролей</h2>
<p class="muted">Кто что делает по документу. Собрано из атомарных требований (субъект, действие, объект) и семантических связей.</p>
<table class="reg">
<tr><th style="width:28%">Роль</th><th>Отвечает за</th><th style="width:28%">Также</th></tr>
<xsl:for-each select="$doc/ism:roles/ism:role">
 <xsl:variable name="rid" select="@id"/>
 <tr id="{@id}">
  <td><strong><xsl:value-of select="ism:name"/></strong>
   <xsl:if test="ism:alias"><div class="muted">
    <xsl:for-each select="ism:alias"><xsl:value-of select="."/><xsl:if test="position()!=last()">; </xsl:if></xsl:for-each></div></xsl:if>
   <div><code><xsl:value-of select="@id"/></code></div>
  </td>
  <td>
   <xsl:choose>
    <xsl:when test="$reqs[ism:subject/@ref=$rid]">
     <ul><xsl:for-each select="$reqs[ism:subject/@ref=$rid]">
      <li><xsl:value-of select="ism:action"/><xsl:text> — </xsl:text>
       <xsl:for-each select="ism:object"><xsl:value-of select="key('byId', @ref)/ism:name"/><xsl:if test="position()!=last()">, </xsl:if></xsl:for-each>
       <xsl:if test="ism:counterpart"> (с: <xsl:for-each select="ism:counterpart"><xsl:value-of select="key('byId', @ref)/ism:name"/><xsl:if test="position()!=last()">, </xsl:if></xsl:for-each>)</xsl:if>
       <xsl:text> </xsl:text><a href="#{@id}" class="muted">п. <xsl:value-of select="@number"/></a></li>
     </xsl:for-each></ul>
    </xsl:when>
    <xsl:otherwise><span class="muted">—</span></xsl:otherwise>
   </xsl:choose>
  </td>
  <td>
   <xsl:for-each select="$reqs[ism:counterpart/@ref=$rid]">
    <div>сторона согласования: <xsl:for-each select="ism:object"><xsl:value-of select="key('byId', @ref)/ism:name"/></xsl:for-each><xsl:text> </xsl:text><a href="#{@id}" class="muted">п. <xsl:value-of select="@number"/></a></div>
   </xsl:for-each>
   <xsl:for-each select="$doc/ism:semanticLinks/ism:link[@to=$rid and @relation='usedBy']">
    <div>ключевой пользователь: <xsl:value-of select="key('byId', @from)/ism:name"/><xsl:if test="@clause"><xsl:text> </xsl:text><a href="#{@clause}" class="muted"><xsl:call-template name="clause-cite"><xsl:with-param name="c" select="key('byId', @clause)"/></xsl:call-template></a></xsl:if></div>
   </xsl:for-each>
   <xsl:for-each select="$doc/ism:scope/ism:audience[@ref=$rid]">
    <div>руководствуется Методикой<xsl:if test="@clause"><xsl:text> </xsl:text><a href="#{@clause}" class="muted"><xsl:call-template name="clause-cite"><xsl:with-param name="c" select="key('byId', @clause)"/></xsl:call-template></a></xsl:if></div>
   </xsl:for-each>
   <xsl:for-each select="$doc/ism:semanticLinks/ism:link[@from=$rid and @relation='definedBy']">
    <div>определение: <xsl:call-template name="ref-label"><xsl:with-param name="ref" select="@to"/></xsl:call-template></div>
   </xsl:for-each>
  </td>
 </tr>
</xsl:for-each>
</table>
</xsl:if>

<xsl:if test="$doc/ism:objects">
<h2 id="objects">Реестр объектов</h2>
<p class="muted">Над чем выполняются требования: документы, разделы ФМ, диаграммы, элементы нотации BPMN.</p>
<table class="reg">
<tr><th style="width:30%">Объект</th><th style="width:14%">Тип</th><th style="width:22%">Код во внешней нотации</th><th>Требования и связи</th></tr>
<xsl:for-each select="$doc/ism:objects/ism:object">
 <xsl:variable name="oid" select="@id"/>
 <tr id="{@id}">
  <td><strong><xsl:value-of select="ism:name"/></strong>
   <xsl:if test="ism:alias"><div class="muted"><xsl:for-each select="ism:alias"><xsl:value-of select="."/><xsl:if test="position()!=last()">; </xsl:if></xsl:for-each></div></xsl:if>
   <xsl:if test="ism:description"><div class="muted"><xsl:value-of select="ism:description"/></div></xsl:if>
  </td>
  <td><xsl:value-of select="@type"/></td>
  <td><xsl:for-each select="ism:externalCode"><code><xsl:value-of select="."/></code><xsl:text> </xsl:text></xsl:for-each></td>
  <td>
   <xsl:variable name="using" select="$reqs[ism:object/@ref=$oid]"/>
   <xsl:if test="$using">
    <div>требований: <xsl:value-of select="count($using)"/> —
     <xsl:for-each select="$using[not(@number = preceding::ism:requirement[ism:object/@ref=$oid]/@number)]">
      <a href="#{@id}">п. <xsl:value-of select="@number"/></a><xsl:if test="position()!=last()">, </xsl:if>
     </xsl:for-each>
    </div>
   </xsl:if>
   <xsl:for-each select="$doc/ism:semanticLinks/ism:link[@from=$oid]">
    <div><xsl:call-template name="relation-label"><xsl:with-param name="code" select="@relation"/></xsl:call-template>:
     <xsl:call-template name="ref-label"><xsl:with-param name="ref" select="@to"/></xsl:call-template></div>
   </xsl:for-each>
   <xsl:for-each select="$doc/ism:semanticLinks/ism:link[@to=$oid and @relation='partOf']">
    <div>включает: <xsl:call-template name="ref-label"><xsl:with-param name="ref" select="@from"/></xsl:call-template></div>
   </xsl:for-each>
  </td>
 </tr>
</xsl:for-each>
</table>
</xsl:if>

<xsl:if test="$doc/ism:semanticLinks">
<h2 id="links">Семантические связи</h2>
<table class="reg">
<tr><th>От</th><th style="width:16%">Связь</th><th>К</th><th style="width:16%">Основание</th></tr>
<xsl:for-each select="$doc/ism:semanticLinks/ism:link">
<tr>
 <td><xsl:call-template name="ref-label"><xsl:with-param name="ref" select="@from"/></xsl:call-template></td>
 <td><xsl:call-template name="relation-label"><xsl:with-param name="code" select="@relation"/></xsl:call-template><div><code><xsl:value-of select="@relation"/></code></div></td>
 <td><xsl:call-template name="ref-label"><xsl:with-param name="ref" select="@to"/></xsl:call-template></td>
 <td><xsl:if test="@clause"><a href="#{@clause}"><xsl:call-template name="clause-cite"><xsl:with-param name="c" select="key('byId', @clause)"/></xsl:call-template></a></xsl:if></td>
</tr>
</xsl:for-each>
</table>
</xsl:if>

<xsl:if test="$doc/ism:editorialNotes">
<h2 id="notes">Замечания к исходному документу</h2>
<p class="muted">Выявлены при переводе документа в XML. Не являются частью нормативного текста; адресованы разработчикам и методологу ИСМ.</p>
<xsl:for-each select="$doc/ism:editorialNotes/ism:note">
 <div class="note" id="{@id}">
  <div class="nhead"><strong><xsl:value-of select="@id"/></strong> · <xsl:call-template name="notetype-label"><xsl:with-param name="code" select="@type"/></xsl:call-template>
   <xsl:if test="@target"> · к объекту: <xsl:call-template name="ref-label"><xsl:with-param name="ref" select="@target"/></xsl:call-template></xsl:if></div>
  <xsl:value-of select="."/>
 </div>
</xsl:for-each>
</xsl:if>

</div>
</xsl:if>

<div class="footer">
Машиночитаемое представление документа ИСМ <xsl:value-of select="$doc/@id"/>, версия <xsl:value-of select="$doc/@version"/>.
Отображение сформировано из XML посредством XSLT (ism-regulation-view.xsl v1.3); источником истины является XML.
</div>

<script>
(function(){
 var btn=document.getElementById('toggleAtoms'), open=false;
 if(btn){btn.addEventListener('click',function(){
  open=!open;
  Array.prototype.forEach.call(document.querySelectorAll('details.atoms'),function(d){d.open=open;});
  btn.textContent=open?'Свернуть атомарные требования':'Развернуть атомарные требования';
 });}
 function reveal(){
  var id=decodeURIComponent(location.hash.slice(1)); if(!id){return;}
  var el=document.getElementById(id); if(!el){return;}
  var d=el.closest('details'); while(d){d.open=true; d=d.parentElement?d.parentElement.closest('details'):null;}
  el.scrollIntoView();
 }
 window.addEventListener('hashchange',reveal); reveal();
})();
</script>

</body>
</html>
</xsl:template>

<!-- ============================================================ -->
<!-- Разделы -->
<xsl:template match="ism:section">
<xsl:choose>
 <xsl:when test="parent::ism:section">
  <h3 id="{@id}"><xsl:call-template name="section-title"/><xsl:call-template name="flags"/></h3>
 </xsl:when>
 <xsl:otherwise>
  <h2 id="{@id}"><xsl:call-template name="section-title"/><xsl:call-template name="flags"/></h2>
 </xsl:otherwise>
</xsl:choose>
<xsl:apply-templates select="ism:paragraph|ism:requirement|ism:clause|ism:section|ism:termList|ism:referenceList"/>
</xsl:template>

<xsl:template name="section-title">
 <xsl:if test="@number"><xsl:value-of select="@number"/>. </xsl:if><xsl:value-of select="@title"/>
</xsl:template>

<xsl:template match="ism:paragraph"><p><xsl:value-of select="."/></p></xsl:template>

<!-- Пункт -->
<xsl:template match="ism:clause">
<div class="clause" id="{@id}">
 <div class="cl-num">
  <xsl:choose>
   <xsl:when test="@label"><xsl:value-of select="@label"/></xsl:when>
   <xsl:when test="@number and not(@number = ../@number)"><xsl:value-of select="@number"/>.</xsl:when>
  </xsl:choose>
 </div>
 <div class="cl-body">
  <xsl:if test="ism:text"><div class="text"><xsl:apply-templates select="ism:text/*" mode="doc"/></div></xsl:if>
  <xsl:call-template name="flags"/>
  <xsl:if test="ism:requirement">
   <details class="atoms">
    <summary>Атомарные требования: <xsl:value-of select="count(ism:requirement)"/></summary>
    <xsl:apply-templates select="ism:requirement"/>
   </details>
  </xsl:if>
  <xsl:apply-templates select="ism:clause"/>
 </div>
</div>
</xsl:template>

<!-- Document Layer: дословный текст -->
<xsl:template match="ism:p" mode="doc"><p><xsl:value-of select="."/></p></xsl:template>
<xsl:template match="ism:list" mode="doc">
 <ul>
  <xsl:if test="@style='dash'"><xsl:attribute name="class">dash</xsl:attribute></xsl:if>
  <xsl:apply-templates select="ism:item" mode="doc"/>
 </ul>
</xsl:template>
<xsl:template match="ism:item" mode="doc"><li><xsl:apply-templates select="node()" mode="doc"/></li></xsl:template>
<xsl:template match="text()" mode="doc"><xsl:value-of select="."/></xsl:template>
<xsl:template match="ism:figure" mode="doc"><div class="fig"><img src="{@src}" alt="{@alt}" loading="lazy"/></div></xsl:template>
<xsl:template match="ism:table" mode="doc">
 <table class="doc">
  <xsl:if test="ism:head"><tr><xsl:for-each select="ism:head/ism:cell"><th><xsl:apply-templates select="node()" mode="doc"/></th></xsl:for-each></tr></xsl:if>
  <xsl:for-each select="ism:row"><tr><xsl:for-each select="ism:cell"><td><xsl:apply-templates select="node()" mode="doc"/></td></xsl:for-each></tr></xsl:for-each>
 </table>
</xsl:template>

<!-- Термины -->
<xsl:template match="ism:termList"><xsl:call-template name="terms-table"/></xsl:template>
<xsl:template name="terms-table">
 <xsl:if test="$doc/ism:terms/ism:note"><p><em><xsl:value-of select="$doc/ism:terms/ism:note"/></em></p></xsl:if>
 <table class="doc">
  <tr><th style="width:32%">Термин (сокращение)</th><th>Определение</th></tr>
  <xsl:for-each select="$doc/ism:terms/ism:term">
   <tr id="{@id}">
    <td><xsl:value-of select="ism:name"/><xsl:if test="ism:abbreviation"> (<xsl:value-of select="ism:abbreviation"/>)</xsl:if><xsl:call-template name="flags"/></td>
    <td><xsl:value-of select="ism:definition"/>
     <xsl:for-each select="ism:note"><p style="margin:6px 0 0"><xsl:value-of select="."/></p></xsl:for-each></td>
   </tr>
  </xsl:for-each>
 </table>
</xsl:template>

<!-- Нормативные ссылки (Приложение) -->
<xsl:template match="ism:referenceList"><xsl:call-template name="refs-table"/></xsl:template>
<xsl:template name="refs-table">
 <table class="doc">
  <tr><th style="width:8%">№</th><th style="width:22%">ID</th><th>Наименование источника</th></tr>
  <xsl:for-each select="$doc/ism:references/ism:reference[not(@origin='derived')]">
   <tr id="{@id}"><td><xsl:value-of select="position()"/>.</td><td><xsl:value-of select="ism:identifier"/></td><td><xsl:value-of select="ism:title"/><xsl:call-template name="flags"/></td></tr>
  </xsl:for-each>
 </table>
 <xsl:if test="$doc/ism:references/ism:reference[@origin='derived']">
  <p class="muted">Используются в тексте, но отсутствуют в перечне:
   <xsl:for-each select="$doc/ism:references/ism:reference[@origin='derived']">
    <span id="{@id}"><strong><xsl:value-of select="ism:identifier"/></strong> — <xsl:value-of select="ism:title"/></span><xsl:call-template name="flags"/><xsl:if test="position()!=last()">; </xsl:if>
   </xsl:for-each>
  </p>
 </xsl:if>
</xsl:template>


<!-- ===== Атомарное требование ===== -->
<xsl:template match="ism:requirement">
<xsl:variable name="rid" select="@id"/>
<div class="atom" id="{@id}">
 <div class="atom-head">
  <code><xsl:value-of select="@id"/></code>
  <xsl:if test="@number"> · п. <xsl:value-of select="@number"/></xsl:if>
 </div>
 <xsl:if test="ism:title"><div class="muted" style="font-size:12.5px"><xsl:value-of select="ism:title"/></div></xsl:if>
 <div class="atom-stmt">
  <xsl:if test="ism:quote"><xsl:attribute name="title">Цитата: «<xsl:value-of select="normalize-space(ism:quote)"/>»</xsl:attribute></xsl:if>
  <xsl:value-of select="ism:statement"/>
 </div>
 <div style="margin-top:4px">
  <span class="badge b-{@modality}"><xsl:call-template name="modality-label"><xsl:with-param name="code" select="@modality"/></xsl:call-template></span>
  <xsl:if test="@modalityBasis='implicit'"><span class="badge b-implicit" title="В тексте нет модального глагола; модальность выведена из изъявительного наклонения или перечня">модальность выведена</span></xsl:if>
  <xsl:if test="@source='authoritative'"><span class="badge b-verbatim">дословно</span></xsl:if>
  <xsl:if test="@kind"><span class="badge"><xsl:call-template name="kind-label"><xsl:with-param name="code" select="@kind"/></xsl:call-template></span></xsl:if>
  <xsl:if test="@criticality"><span class="badge b-{@criticality}" title="{concat('Критичность ', @criticality)}"><xsl:value-of select="@criticality"/></span></xsl:if>
  <xsl:if test="ism:quote and not(contains(normalize-space(../ism:text), normalize-space(ism:quote)))"><span class="warn">цитата не найдена в тексте пункта</span></xsl:if>
  <xsl:call-template name="flags"/>
 </div>
 <dl class="props">
  <xsl:if test="ism:subject"><dt>Кто</dt><dd><xsl:call-template name="ref-label"><xsl:with-param name="ref" select="ism:subject/@ref"/></xsl:call-template></dd></xsl:if>
  <xsl:if test="ism:action"><dt>Действие</dt><dd><xsl:value-of select="ism:action"/> <span class="muted"> (<xsl:value-of select="ism:action/@code"/>)</span></dd></xsl:if>
  <xsl:if test="ism:object"><dt>Объект</dt><dd>
   <xsl:for-each select="ism:object"><xsl:call-template name="ref-label"><xsl:with-param name="ref" select="@ref"/></xsl:call-template><xsl:if test="position()!=last()">; </xsl:if></xsl:for-each></dd></xsl:if>
  <xsl:if test="ism:counterpart"><dt>Совместно с</dt><dd>
   <xsl:for-each select="ism:counterpart"><xsl:call-template name="ref-label"><xsl:with-param name="ref" select="@ref"/></xsl:call-template><xsl:if test="position()!=last()">; </xsl:if></xsl:for-each></dd></xsl:if>
  <xsl:if test="ism:owner"><dt>Владелец</dt><dd><xsl:call-template name="ref-label"><xsl:with-param name="ref" select="ism:owner/@ref"/></xsl:call-template>
   <xsl:if test="not(ism:owner/@status='confirmed')"> <span class="muted">(предварительно)</span></xsl:if></dd></xsl:if>
  <xsl:if test="@criticality"><dt>Критичность</dt><dd><strong><xsl:value-of select="@criticality"/></strong>, <xsl:call-template name="criticality-label"><xsl:with-param name="code" select="@criticality"/></xsl:call-template>
   <xsl:if test="ism:criticalityBasis">. <xsl:value-of select="ism:criticalityBasis"/></xsl:if>
   <xsl:if test="ism:criticalityBasis and not(ism:criticalityBasis/@status='confirmed')"> <span class="muted">(предварительно)</span></xsl:if></dd></xsl:if>
  <xsl:if test="ism:applicability"><dt>Условие</dt><dd>
   <xsl:for-each select="ism:applicability/ism:condition"><xsl:value-of select="."/><xsl:if test="position()!=last()">; </xsl:if></xsl:for-each></dd></xsl:if>
  <xsl:if test="ism:verification/ism:criterion"><dt>Критерий приёмки</dt><dd><xsl:value-of select="ism:verification/ism:criterion"/></dd></xsl:if>
  <xsl:if test="ism:verification"><dt>Проверка</dt><dd>
   <xsl:call-template name="verification-label"><xsl:with-param name="code" select="ism:verification/@method"/></xsl:call-template>
   <xsl:for-each select="ism:verification/ism:check">
    <details class="check"><summary>машинная проверка: <xsl:value-of select="@language"/> по <xsl:value-of select="@target"/><xsl:if test="@status='proposed'"> (предложена)</xsl:if></summary><code><xsl:value-of select="."/></code></details>
   </xsl:for-each></dd></xsl:if>
  <xsl:if test="ism:externalReference"><dt>Источник</dt><dd>
   <xsl:for-each select="ism:externalReference"><xsl:call-template name="ref-label"><xsl:with-param name="ref" select="@ref"/></xsl:call-template><xsl:if test="position()!=last()">; </xsl:if></xsl:for-each></dd></xsl:if>
  <xsl:if test="//ism:link[@from=$rid or @to=$rid]"><dt>Связи</dt><dd>
   <xsl:for-each select="//ism:link[@from=$rid]"><xsl:call-template name="relation-label"><xsl:with-param name="code" select="@relation"/></xsl:call-template>: <xsl:call-template name="ref-label"><xsl:with-param name="ref" select="@to"/></xsl:call-template><br/></xsl:for-each>
   <xsl:for-each select="//ism:link[@to=$rid]">← <xsl:call-template name="ref-label"><xsl:with-param name="ref" select="@from"/></xsl:call-template> (<xsl:value-of select="@relation"/>)<br/></xsl:for-each></dd></xsl:if>
  <xsl:if test="ism:registry"><dt>Карточка реестра</dt><dd><code><xsl:value-of select="ism:registry/@id"/></code>
   <xsl:if test="ism:registry/@level">, уровень <xsl:value-of select="ism:registry/@level"/></xsl:if>
   <xsl:if test="ism:registry/@status">, <xsl:call-template name="regstatus-label"><xsl:with-param name="code" select="ism:registry/@status"/></xsl:call-template></xsl:if>
   <xsl:if test="ism:registry/@version">, версия <xsl:value-of select="ism:registry/@version"/></xsl:if>
   <xsl:if test="ism:registry/ism:remark"><div class="muted"><xsl:value-of select="ism:registry/ism:remark"/></div></xsl:if></dd></xsl:if>
  <xsl:if test="ism:tags"><dt>Теги</dt><dd><xsl:for-each select="ism:tags/ism:tag"><code><xsl:value-of select="."/></code><xsl:text> </xsl:text></xsl:for-each></dd></xsl:if>
 </dl>
</div>
</xsl:template>

<!-- ===== Вспомогательные шаблоны ===== -->
<xsl:template match="*" mode="party">
 <div><xsl:value-of select="."/><xsl:if test="@person"><xsl:text> </xsl:text><xsl:value-of select="@person"/></xsl:if></div>
</xsl:template>

<!-- Метки замечаний к текущему элементу -->
<xsl:template name="flags">
 <xsl:if test="@id">
  <xsl:for-each select="key('notesByTarget', @id)">
   <a class="flag" href="#{@id}" title="Замечание к исходному документу"><xsl:text>⚑ </xsl:text><xsl:value-of select="@id"/></a>
  </xsl:for-each>
 </xsl:if>
</xsl:template>

<xsl:template name="clause-cite">
 <xsl:param name="c"/>
 <xsl:choose>
  <xsl:when test="$c/@label">п. <xsl:value-of select="$c/parent::ism:clause/@number"/><xsl:text> </xsl:text><xsl:value-of select="$c/@label"/></xsl:when>
  <xsl:when test="$c/@number">п. <xsl:value-of select="$c/@number"/></xsl:when>
  <xsl:when test="$c/parent::ism:section[@kind='appendix']"><xsl:value-of select="$c/parent::ism:section/@number"/></xsl:when>
  <xsl:otherwise>раздел <xsl:value-of select="$c/parent::ism:section/@number"/>, вводный абзац</xsl:otherwise>
 </xsl:choose>
</xsl:template>

<xsl:template name="ref-label">
 <xsl:param name="ref"/>
 <xsl:variable name="t" select="key('byId', $ref)[1]"/>
 <xsl:choose>
  <xsl:when test="$t/self::ism:role or $t/self::ism:object"><a href="#{$ref}"><xsl:value-of select="$t/ism:name"/></a></xsl:when>
  <xsl:when test="$t/self::ism:reference"><a href="#{$ref}"><xsl:value-of select="$t/ism:identifier"/></a> — <xsl:value-of select="$t/ism:title"/></xsl:when>
  <xsl:when test="$t/self::ism:requirement"><a href="#{$ref}">п. <xsl:value-of select="$t/@number"/></a><xsl:text> </xsl:text><code><xsl:value-of select="$ref"/></code></xsl:when>
  <xsl:when test="$t/self::ism:term"><a href="#{$ref}"><xsl:value-of select="$t/ism:name"/></a><xsl:if test="$t/ism:abbreviation"> (<xsl:value-of select="$t/ism:abbreviation"/>)</xsl:if></xsl:when>
  <xsl:when test="$t/self::ism:clause"><a href="#{$ref}"><xsl:call-template name="clause-cite"><xsl:with-param name="c" select="$t"/></xsl:call-template></a></xsl:when>
  <xsl:when test="$t/self::ism:section"><a href="#{$ref}">раздел <xsl:value-of select="$t/@number"/>. <xsl:value-of select="$t/@title"/></a></xsl:when>
  <xsl:when test="$t/self::ism:ismDocument">документ <xsl:value-of select="$ref"/></xsl:when>
  <xsl:otherwise><code><xsl:value-of select="$ref"/></code><span class="warn">не определён в документе</span></xsl:otherwise>
 </xsl:choose>
</xsl:template>

<xsl:template name="modality-label">
 <xsl:param name="code"/>
 <xsl:choose>
  <xsl:when test="$code='shall'">обязательно</xsl:when>
  <xsl:when test="$code='should'">рекомендуется</xsl:when>
  <xsl:when test="$code='may'">допускается</xsl:when>
  <xsl:when test="$code='shall-not'">запрещено</xsl:when>
  <xsl:otherwise><xsl:value-of select="$code"/></xsl:otherwise>
 </xsl:choose>
</xsl:template>

<xsl:template name="kind-label">
 <xsl:param name="code"/>
 <xsl:choose>
  <xsl:when test="$code='responsibility'">ответственность</xsl:when>
  <xsl:when test="$code='structure'">состав ФМ</xsl:when>
  <xsl:when test="$code='content'">содержание раздела</xsl:when>
  <xsl:when test="$code='method'">метод</xsl:when>
  <xsl:when test="$code='notation'">нотация</xsl:when>
  <xsl:when test="$code='modeling-rule'">правило моделирования</xsl:when>
  <xsl:when test="$code='process-rule'">правило процесса</xsl:when>
  <xsl:when test="$code='document-control'">управление документом</xsl:when>
  <xsl:when test="$code='scope'">область применения</xsl:when>
  <xsl:otherwise><xsl:value-of select="$code"/></xsl:otherwise>
 </xsl:choose>
</xsl:template>

<xsl:template name="verification-label">
 <xsl:param name="code"/>
 <xsl:choose>
  <xsl:when test="$code='document-review'">экспертиза документа</xsl:when>
  <xsl:when test="$code='model-validation'">проверка BPMN-модели</xsl:when>
  <xsl:when test="$code='expert-review'">экспертная оценка</xsl:when>
  <xsl:when test="$code='record-check'">проверка записей: лист согласования, история изменений</xsl:when>
  <xsl:otherwise><xsl:value-of select="$code"/></xsl:otherwise>
 </xsl:choose>
</xsl:template>

<xsl:template name="criticality-label">
 <xsl:param name="code"/>
 <xsl:choose>
  <xsl:when test="$code='C1'">критические, корпоративно неприемлемые последствия невыполнения</xsl:when>
  <xsl:when test="$code='C2'">высокие существенные последствия невыполнения</xsl:when>
  <xsl:when test="$code='C3'">средние локальные управляемые последствия невыполнения</xsl:when>
  <xsl:when test="$code='C4'">низкие ограниченные обратимые последствия невыполнения</xsl:when>
  <xsl:otherwise><xsl:value-of select="$code"/></xsl:otherwise>
 </xsl:choose>
</xsl:template>

<xsl:template name="regstatus-label">
 <xsl:param name="code"/>
 <xsl:choose>
  <xsl:when test="$code='draft'">черновик</xsl:when>
  <xsl:when test="$code='operator-review'">на проверке оператора</xsl:when>
  <xsl:when test="$code='approval'">на согласовании</xsl:when>
  <xsl:when test="$code='approved'">утверждено</xsl:when>
  <xsl:when test="$code='effective'">действует</xsl:when>
  <xsl:when test="$code='revision'">на пересмотре</xsl:when>
  <xsl:when test="$code='superseded'">заменено</xsl:when>
  <xsl:when test="$code='archived'">архив</xsl:when>
  <xsl:otherwise><xsl:value-of select="$code"/></xsl:otherwise>
 </xsl:choose>
</xsl:template>

<xsl:template name="relation-label">
 <xsl:param name="code"/>
 <xsl:choose>
  <xsl:when test="$code='constrainedBy'">ограничивается</xsl:when>
  <xsl:when test="$code='references'">ссылается на</xsl:when>
  <xsl:when test="$code='partOf'">входит в</xsl:when>
  <xsl:when test="$code='definedBy'">определение</xsl:when>
  <xsl:when test="$code='usedBy'">используется</xsl:when>
  <xsl:when test="$code='requires'">требует</xsl:when>
  <xsl:when test="$code='implements'">реализует</xsl:when>
  <xsl:when test="$code='supersedes'">заменяет</xsl:when>
  <xsl:when test="$code='conflictsWith'">противоречит</xsl:when>
  <xsl:when test="$code='clarifies'">уточняет</xsl:when>
  <xsl:when test="$code='appliesTo'">применяется к</xsl:when>
  <xsl:when test="$code='performedBy'">выполняется</xsl:when>
  <xsl:when test="$code='verifiedBy'">проверяется</xsl:when>
  <xsl:when test="$code='inputOf'">вход для</xsl:when>
  <xsl:when test="$code='outputOf'">выход из</xsl:when>
  <xsl:otherwise><xsl:value-of select="$code"/></xsl:otherwise>
 </xsl:choose>
</xsl:template>

<xsl:template name="status-label">
 <xsl:param name="code"/>
 <xsl:choose>
  <xsl:when test="$code='draft'">проект (draft) — не утверждён</xsl:when>
  <xsl:when test="$code='effective'">действующий (effective)</xsl:when>
  <xsl:when test="$code='superseded'">заменён (superseded)</xsl:when>
  <xsl:when test="$code='withdrawn'">отменён (withdrawn)</xsl:when>
  <xsl:otherwise><xsl:value-of select="$code"/></xsl:otherwise>
 </xsl:choose>
</xsl:template>

<xsl:template name="notetype-label">
 <xsl:param name="code"/>
 <xsl:choose>
  <xsl:when test="$code='duplicate'">дублирование</xsl:when>
  <xsl:when test="$code='inconsistency'">несогласованность</xsl:when>
  <xsl:when test="$code='gap'">пробел</xsl:when>
  <xsl:when test="$code='wording'">формулировка</xsl:when>
  <xsl:when test="$code='formatting'">оформление</xsl:when>
  <xsl:when test="$code='interpretation'">трактовка при разметке</xsl:when>
  <xsl:when test="$code='question'">вопрос к методологу</xsl:when>
  <xsl:otherwise><xsl:value-of select="$code"/></xsl:otherwise>
 </xsl:choose>
</xsl:template>

</xsl:stylesheet>
