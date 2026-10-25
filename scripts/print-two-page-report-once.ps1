param(
    [Parameter(Mandatory = $true)] [string]$TicketPath,
    [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
$ticketFile = (Resolve-Path -LiteralPath $TicketPath).Path
$ticket = Get-Content -LiteralPath $ticketFile -Raw | ConvertFrom-Json
$printerName = 'Brother DCP-L2540DW series Printer'
if ($ticket.PrinterName -cne $printerName -or $ticket.Copies -ne 1 -or $ticket.PageCount -ne 2 -or @($ticket.Images).Count -ne 2) {
    throw 'Only the approved two-page, one-copy Brother print ticket is permitted.'
}
$jobRoot = Split-Path -Parent $ticketFile
foreach ($contentPath in @($ticket.PdfPath, $ticket.ReceiptPath) + @($ticket.Images | ForEach-Object { $_.Path })) {
    if ((Split-Path -Parent ([IO.Path]::GetFullPath([string]$contentPath))) -ine $jobRoot) { throw 'A print path escapes the exact job directory.' }
}
if (Test-Path -LiteralPath $ticket.ReceiptPath) {
    Get-Content -LiteralPath $ticket.ReceiptPath
    Write-Output 'PRINT_NOT_REPEATED: A receipt already exists, including any uncertain submission.'
    return
}
if ((Get-FileHash -LiteralPath $ticket.PdfPath -Algorithm SHA256).Hash -ine $ticket.PdfSha256) { throw 'The PDF changed.' }
Get-Printer -Name $printerName -ErrorAction Stop | Out-Null
Add-Type -AssemblyName System.Drawing
$images = [Collections.Generic.List[Drawing.Image]]::new()
$document = [Drawing.Printing.PrintDocument]::new()
$handler = $null
try {
    foreach ($page in $ticket.Images) {
        if ((Get-FileHash -LiteralPath $page.Path -Algorithm SHA256).Hash -ine $page.Sha256) { throw 'A prepared print image changed.' }
        $image = [Drawing.Image]::FromFile([string]$page.Path)
        $images.Add($image)
        if ($image.Width -ne $page.Width -or $image.Height -ne $page.Height) { throw 'A print image has unexpected dimensions.' }
    }
    $document.PrinterSettings.PrinterName = $printerName
    $document.PrinterSettings.Copies = 1
    $document.PrinterSettings.PrintRange = [Drawing.Printing.PrintRange]::AllPages
    $document.DocumentName = [string]$ticket.DocumentName
    $document.PrintController = [Drawing.Printing.StandardPrintController]::new()
    if (-not $document.PrinterSettings.IsValid) { throw 'The exact Brother printer is not valid.' }
    if ($ValidateOnly) {
        [pscustomobject]@{Status='validated_not_printed';Printer=$printerName;Pages=2;Copies=1} | ConvertTo-Json
        return
    }
    $now = [DateTimeOffset]::UtcNow
    if ($now -lt [DateTimeOffset]::Parse([string]$ticket.AuthorizedAt) -or $now -gt [DateTimeOffset]::Parse([string]$ticket.Deadline)) {
        throw 'The immediate printing authorization has expired; no job was submitted.'
    }
    # Capture the queue before creating a durable, exclusive receipt. Never retry Print().
    $before = @(Get-PrintJob -PrinterName $printerName -ErrorAction Stop | Select-Object -ExpandProperty ID)
    try { $stream = [IO.File]::Open([string]$ticket.ReceiptPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None) }
    catch [IO.IOException] {
        if (Test-Path -LiteralPath $ticket.ReceiptPath) { Write-Output 'PRINT_NOT_REPEATED: A receipt already exists.'; return }
        throw
    }
    $state = [ordered]@{Status='submission_started_outcome_unconfirmed';StartedAt=$now.ToString('o');Printer=$printerName;
        DocumentName=$document.DocumentName;Pages=2;Copies=1;PdfSha256=$ticket.PdfSha256}
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes(($state | ConvertTo-Json))
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    } finally { $stream.Dispose() }
    $script:twoPageReportIndex = 0
    $handler = [Drawing.Printing.PrintPageEventHandler]{
        param($sender, $eventArgs)
        if ($script:twoPageReportIndex -ge 2) { throw 'An extra page was refused.' }
        $pageImage = $images[$script:twoPageReportIndex]
        $area = $eventArgs.PageSettings.PrintableArea
        $scale = [Math]::Min($area.Width / $pageImage.Width, $area.Height / $pageImage.Height)
        $width = [single]($pageImage.Width * $scale)
        $height = [single]($pageImage.Height * $scale)
        $x = [single]($area.Left + ($area.Width - $width) / 2 - $eventArgs.PageSettings.HardMarginX)
        $y = [single]($area.Top + ($area.Height - $height) / 2 - $eventArgs.PageSettings.HardMarginY)
        $eventArgs.Graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $eventArgs.Graphics.DrawImage($pageImage, $x, $y, $width, $height)
        $script:twoPageReportIndex++
        $eventArgs.HasMorePages = $script:twoPageReportIndex -lt 2
    }
    $document.add_PrintPage($handler)
    $document.Print()
    $state.Status = 'submitted_to_windows_spooler'
    $state['SubmittedAt'] = [DateTimeOffset]::UtcNow.ToString('o')
    $state['PagesDrawn'] = $script:twoPageReportIndex
    [IO.File]::WriteAllText([string]$ticket.ReceiptPath, ($state | ConvertTo-Json -Depth 6))
    try {
        $after = @(Get-PrintJob -PrinterName $printerName -ErrorAction Stop)
        $state['NewQueueJobs'] = @($after | Where-Object { $_.ID -notin $before } | ForEach-Object {
            [ordered]@{ID=$_.ID;DocumentName=$_.DocumentName;JobStatus=[string]$_.JobStatus;TotalPages=$_.TotalPages}
        })
    } catch { $state['QueueInspection'] = 'unavailable_after_submission_do_not_retry' }
    [IO.File]::WriteAllText([string]$ticket.ReceiptPath, ($state | ConvertTo-Json -Depth 6))
    $state | ConvertTo-Json -Depth 6
} finally {
    if ($handler) { $document.remove_PrintPage($handler) }
    $document.Dispose()
    foreach ($image in $images) { $image.Dispose() }
}
