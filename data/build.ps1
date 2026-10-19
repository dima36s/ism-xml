<#
  build.ps1 — сборка Human View для документов ИСМ.

  Для каждого XML-документа ИСМ в папке скрипта:
    1) проверяет, что корневой элемент в пространстве имён urn:protech:ism:regulation:1.0;
    2) валидирует XML по ism-regulation-v1.xsd (схема 1.1 сама ловит ссылки на несуществующие роли,
       объекты, источники и пункты — через xs:key/xs:keyref);
    3) проверяет, что ссылки (subject, object, counterpart, externalReference, link) указывают на объекты документа;
    4) проверяет, что дословная цитата <quote> каждого атомарного требования есть в тексте его пункта;
    5) если документ валиден — формирует рядом HTML через ism-regulation-view.xsl
       (рисунки берутся из папки media рядом с XML).

  Запуск: двойной щелчок по build.bat
     или: powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1 [-Xml файл.xml]
  Работает в Windows PowerShell 5.1 и PowerShell 7, ничего устанавливать не нужно.
#>
param(
    [string[]]$Xml,
    [string]$Xsd = 'ism-regulation-v1.xsd',
    [string]$Xsl = 'ism-regulation-view.xsl'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$ns = 'urn:protech:ism:regulation:1.0'

function Resolve-Local([string]$p) {
    if ([System.IO.Path]::IsPathRooted($p)) { return $p }
    return (Join-Path $root $p)
}

$xsdPath = Resolve-Local $Xsd
$xslPath = Resolve-Local $Xsl
foreach ($p in @($xsdPath, $xslPath)) {
    if (-not (Test-Path $p)) { Write-Host "Не найден файл: $p" -ForegroundColor Red; exit 2 }
}

if (-not $Xml) {
    $Xml = @(Get-ChildItem -Path $root -Filter '*.xml' | ForEach-Object { $_.FullName })
}
if ($Xml.Count -eq 0) { Write-Host "В папке $root нет XML-файлов." -ForegroundColor Yellow; exit 0 }

$schemas = New-Object System.Xml.Schema.XmlSchemaSet
[void]$schemas.Add($ns, $xsdPath)
$schemas.Compile()

$xslt = New-Object System.Xml.Xsl.XslCompiledTransform
$xslt.Load($xslPath)

$failed = 0
foreach ($f in $Xml) {
    $path = Resolve-Local $f
    $name = [System.IO.Path]::GetFileName($path)
    Write-Host ''
    Write-Host "== $name" -ForegroundColor Cyan

    # 0. Это документ ИСМ? Пространство имён на месте?
    $dom = New-Object System.Xml.XmlDocument
    $dom.PreserveWhitespace = $true   # пробелы между пунктами списков нужны для сверки цитат
    try { $dom.Load($path) }
    catch { Write-Host "  XML не читается: $($_.Exception.Message)" -ForegroundColor Red; $failed++; continue }

    $rootEl = $dom.DocumentElement
    if ($rootEl.LocalName -ne 'ismDocument') {
        Write-Host "  пропущен: корневой элемент <$($rootEl.LocalName)>, это не документ ИСМ" -ForegroundColor DarkGray
        continue
    }
    if ($rootEl.NamespaceURI -ne $ns) {
        Write-Host "  ОШИБКА: у <ismDocument> нет пространства имён $ns." -ForegroundColor Red
        Write-Host "  Добавьте атрибут xmlns=`"$ns`" — без него XSD и XSLT документ не видят." -ForegroundColor Red
        $failed++; continue
    }

    # 1. Валидация по XSD
    $errors = New-Object 'System.Collections.Generic.List[string]'
    $settings = New-Object System.Xml.XmlReaderSettings
    $settings.ValidationType = [System.Xml.ValidationType]::Schema
    $settings.Schemas = $schemas
    $settings.ValidationFlags = $settings.ValidationFlags -bor [System.Xml.Schema.XmlSchemaValidationFlags]::ReportValidationWarnings
    $handler = {
        param($sender, $e)
        $errors.Add(('строка {0}: {1}' -f $e.Exception.LineNumber, $e.Message))
    }.GetNewClosure()
    $settings.add_ValidationEventHandler([System.Xml.Schema.ValidationEventHandler]$handler)

    $reader = [System.Xml.XmlReader]::Create($path, $settings)
    try { while ($reader.Read()) { } }
    catch { $errors.Add($_.Exception.Message) }
    finally { $reader.Close() }

    if ($errors.Count -gt 0) {
        Write-Host "  XSD: ошибок $($errors.Count)" -ForegroundColor Red
        $errors | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        Write-Host '  HTML не сформирован: невалидный источник не публикуем.' -ForegroundColor Red
        $failed++; continue
    }
    Write-Host '  XSD: валиден' -ForegroundColor Green

    # 2. Целостность ссылок внутри документа (предупреждение, сборку не останавливает)
    $nsm = New-Object System.Xml.XmlNamespaceManager($dom.NameTable)
    $nsm.AddNamespace('i', $ns)
    $ids = @{}
    foreach ($n in $dom.SelectNodes('//*[@id]')) { $ids[$n.GetAttribute('id')] = $true }
    $refs = $dom.SelectNodes('//i:requirement/i:subject/@ref | //i:requirement/i:object/@ref | //i:requirement/i:counterpart/@ref | //i:externalReference/@ref | //i:link/@from | //i:link/@to', $nsm)
    $dangling = @($refs | Where-Object { -not $ids.ContainsKey($_.Value) } | ForEach-Object { $_.Value } | Sort-Object -Unique)
    if ($dangling.Count -gt 0) {
        Write-Host "  Ссылки: не определены в документе — $($dangling -join ', ')" -ForegroundColor Yellow
    } else {
        Write-Host "  Ссылки: все разрешены ($($refs.Count))" -ForegroundColor Green
    }

    # 3. Цитаты атомарных требований должны дословно присутствовать в тексте своего пункта
    $reqs = $dom.SelectNodes('//i:requirement', $nsm)
    $quoted = 0; $badQuotes = @()
    foreach ($r in $reqs) {
        $q = $r.SelectSingleNode('i:quote', $nsm)
        if ($null -eq $q) { continue }
        $quoted++
        $t = $r.ParentNode.SelectSingleNode('i:text', $nsm)
        $clauseText = if ($null -ne $t) { ($t.InnerText -replace '\s+', ' ').Trim() } else { '' }
        $quoteText = ($q.InnerText -replace '\s+', ' ').Trim()
        if (-not $clauseText.Contains($quoteText)) { $badQuotes += $r.GetAttribute('id') }
    }
    if ($badQuotes.Count -gt 0) {
        Write-Host "  Цитаты: не найдены в тексте пункта — $($badQuotes -join ', ')" -ForegroundColor Yellow
    } elseif ($quoted -gt 0) {
        Write-Host "  Цитаты: все $quoted найдены в тексте своих пунктов (требований: $($reqs.Count))" -ForegroundColor Green
    }

    # 4. Human View
    $base = [System.IO.Path]::GetFileNameWithoutExtension($path) -replace '\.machine-readable$', ''
    $out = Join-Path ([System.IO.Path]::GetDirectoryName($path)) ($base + '.html')
    $xslt.Transform($path, $out)
    Write-Host "  HTML: $([System.IO.Path]::GetFileName($out))" -ForegroundColor Green
}

Write-Host ''
if ($failed -gt 0) { Write-Host "Готово с ошибками: $failed" -ForegroundColor Red; exit 1 }
Write-Host 'Готово.' -ForegroundColor Green
exit 0
